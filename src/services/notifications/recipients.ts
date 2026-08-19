import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { Permission } from "@/lib/auth/permissions";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { Organization, OrganizationMember, StaffProfile, User } from "@/lib/db/models/identity";
import { Entitlement } from "@/lib/db/models/commerce";
import { VendorMember } from "@/lib/db/models/vendors";
import { Conversation, Message } from "@/lib/db/models/communication";
import type { OrganizationRole } from "@/lib/db/enums";
import { log } from "@/lib/logger";
import type { Audience } from "./catalog";

/**
 * Who hears about it — §69.
 *
 * ## Resolution is a query, never a claim in the payload
 *
 * An event carries an organisation id and a subject. It does not carry a list
 * of user ids, and this module never accepts one. That is the same discipline
 * as the DAL: the emitter says *what happened*, the platform decides *who is
 * allowed to know*, and the two cannot drift because only one of them queries
 * memberships.
 *
 * ## Staff audiences are resolved by permission, not by role name
 *
 * §77's rule. "Everybody who can see requests" survives a new staff role being
 * added; "everybody who is customer_service" does not, and the failure is
 * silent — the new role simply never hears anything.
 */

export interface Recipient {
  userId: string;
  email: string;
  name?: string;
  organizationId?: string;
}

export async function resolveAudience(
  audience: Audience,
  context: {
    organizationId?: string;
    /** The customer whose thing this is, when the event names one. */
    ownerUserId?: string;
    assigneeUserId?: string;
    productId?: string;
    /**
     * Several products at once — vendor ticket 12's offboarding notice.
     *
     * One event, one audience, many products: telling a customer four times that their vendor
     * has left because they bought four things would be worse than not telling them.
     */
    productIds?: readonly string[];
    /** Vendor tickets 01, 05 — whose vendor account this concerns. */
    vendorId?: string;
    conversationId?: string;
    /** Excluded from every audience — nobody is notified of their own action. */
    actorUserId?: string;
    messageAudience?: "customer" | "internal";
  },
): Promise<Recipient[]> {
  await connectToDatabase();

  const found = await resolve(audience, context);

  // Self-notification is noise on every screen it reaches. The person who
  // pressed the button already knows.
  const filtered = context.actorUserId
    ? found.filter((row) => row.userId !== context.actorUserId)
    : found;

  // One row per user. An audience can overlap another (an owner who is also
  // the billing contact) and two notifications for one event is the duplicate
  // the criterion forbids.
  return [...new Map(filtered.map((row) => [row.userId, row])).values()];
}

async function resolve(
  audience: Audience,
  context: Parameters<typeof resolveAudience>[1],
): Promise<Recipient[]> {
  switch (audience.kind) {
    case "organization":
      return organizationMembers(context.organizationId, audience.roles);

    case "customer_owner":
      return context.ownerUserId ? users([context.ownerUserId]) : [];

    case "assignee":
      return context.assigneeUserId ? users([context.assigneeUserId]) : [];

    case "staff":
      return staffWith(audience.permission as Permission);

    case "entitled_owners":
      return entitledOwners(context.productId, context.productIds);

    case "vendor_member":
      return vendorMembers(context.vendorId);

    case "message_counterpart":
      return counterpart(context);
  }
}

/* ────────────────────────────────────────────── customer side */

/** No repository read is unbounded (§94), including the ones that look small. */
const MAX_ORGANIZATION_MEMBERS = 200;
const MAX_ENTITLED_ORGANIZATIONS = 500;

async function organizationMembers(
  organizationId: string | undefined,
  roles?: readonly string[],
): Promise<Recipient[]> {
  if (!organizationId) return [];

  const members = await OrganizationMember.find({
    organizationId: toObjectId(organizationId),
    status: "active",
    ...(roles ? { role: { $in: roles as OrganizationRole[] } } : {}),
  })
    .select({ userId: 1 })
    // One organisation's members. Bounded on principle rather than on any
    // expectation of hitting it (§94).
    .limit(MAX_ORGANIZATION_MEMBERS)
    .lean<Array<{ userId: unknown }>>();

  return users(
    members.map((row) => String(row.userId)),
    organizationId,
  );
}

/**
 * Everyone with an active entitlement for the product — §69's update notice.
 *
 * Distinct organisations, then their members. Deliberately not "everyone who
 * ever bought it": a lapsed or revoked entitlement is not a reason to be told
 * about a release, and telling somebody about an update they cannot download is
 * worse than silence.
 */
/**
 * Every active member of one vendor — vendor tickets 01 and 05.
 *
 * For most vendors this is one person, which is the point: a solo vendor and a small
 * team resolve through the same path, so nothing downstream branches on "has a team".
 *
 * `status: "active"` matters — a revoked member must stop hearing about the products
 * they used to work on, and the membership is the only thing that says so.
 *
 * Bounded like every other read here (§94), though the cap is generous relative to
 * any real vendor team.
 */
const MAX_VENDOR_MEMBERS = 50;

async function vendorMembers(vendorId?: string): Promise<Recipient[]> {
  if (!vendorId) return [];

  const members = await VendorMember.find({
    vendorId: toObjectId(vendorId),
    status: "active",
  })
    .select({ userId: 1 })
    .limit(MAX_VENDOR_MEMBERS)
    .lean<Array<{ userId: unknown }>>();

  return users(members.map((row) => String(row.userId)));
}

async function entitledOwners(
  productId?: string,
  productIds?: readonly string[],
): Promise<Recipient[]> {
  // One or many. `productIds` is vendor ticket 12's offboarding case, where the audience is
  // everybody holding anything that vendor sold — deduplicated by organisation below, so a
  // customer who bought three of their products is told once.
  const ids = productIds?.length ? productIds : productId ? [productId] : [];
  if (ids.length === 0) return [];

  const entitlements = await Entitlement.find({
    productId: { $in: ids.slice(0, 100).map((id) => toObjectId(id)) },
    status: "active",
  })
    .select({ organizationId: 1 })
    // Bounded (§94). A release notice fanning out to every customer of a
    // popular product is the largest audience in the system, and it runs
    // inline on the event bus — an unbounded read here is the one that would
    // actually hurt. Beyond this, the fan-out belongs in a job rather than in
    // a bigger limit.
    .limit(MAX_ENTITLED_ORGANIZATIONS)
    .lean<Array<{ organizationId: unknown }>>();

  const organizationIds = [...new Set(entitlements.map((row) => String(row.organizationId)))];

  const batches = await Promise.all(
    // The technical contacts, not the billing ones — §89 puts deliverables and
    // licence keys with the people who use them.
    organizationIds.map((id) =>
      organizationMembers(id, ["owner", "admin", "technical", "member"]),
    ),
  );

  return batches.flat();
}

/* ────────────────────────────────────────────── staff side */

/**
 * Everyone whose roles include a permission.
 *
 * ## Filtered in memory, and bounded because of it
 *
 * The permission is not a field — it is derived from `roles` by
 * `permissionsForRoles`, which is §77's whole point: "everybody who can see
 * requests" survives a new role being added, and "everybody who is
 * customer_service" does not. That derivation cannot be expressed as a query,
 * so the rows come back and the filter happens here.
 *
 * The cost is a read of every active staff profile on **every dispatch**, and
 * this ran unbounded (§94). `MAX_STAFF` caps it. A hundred is far beyond any
 * plausible staff list for this platform, so in practice nothing is dropped —
 * but "in practice" is not a bound, and an unbounded read on the hot path of
 * every notification is how a sweep takes the database down.
 *
 * Sorted, so the cap truncates deterministically rather than by whatever order
 * the storage engine returns.
 */
const MAX_STAFF = 100;

async function staffWith(permission: Permission): Promise<Recipient[]> {
  // The profile, not the user: `isStaff` says somebody works here and the
  // profile says what they do. `isActive` matters — a suspended staff member
  // who still has a login must not keep receiving queue mail.
  const profiles = await StaffProfile.find({ isActive: true, deletedAt: null })
    .select({ userId: 1, roles: 1 })
    .sort({ createdAt: 1 })
    .limit(MAX_STAFF + 1)
    .lean<Array<{ userId: unknown; roles: string[] }>>();

  if (profiles.length > MAX_STAFF) {
    // Said out loud rather than silently truncated. If this ever fires, the
    // audience needs a real query — a `permissions` array denormalised onto
    // the profile — not a bigger number here.
    log.warn("More active staff than the notification audience cap", {
      code: "notifications.staff_cap",
      cap: MAX_STAFF,
    });
    profiles.length = MAX_STAFF;
  }

  const entitled = profiles
    .filter((row) => permissionsForRoles(row.roles).has(permission))
    .map((row) => String(row.userId));

  return users(entitled);
}

/* ────────────────────────────────────────────── conversations */

/**
 * The other side of a thread — ticket 21, §37.
 *
 * An **internal** message reaches staff participants only. Not "everyone minus
 * the customer": staff-only is the default the whole visibility model rests on,
 * and expressing it as an exclusion is how one missed filter leaks a note.
 */
async function counterpart(
  context: Parameters<typeof resolveAudience>[1],
): Promise<Recipient[]> {
  if (!context.conversationId) return [];

  const conversation = await Conversation.findById(toObjectId(context.conversationId))
    .select({ participantUserIds: 1, organizationId: 1 })
    .lean<{ participantUserIds: unknown[]; organizationId: unknown }>();
  if (!conversation) return [];

  const participants = await users(
    conversation.participantUserIds.map((id) => String(id)),
    String(conversation.organizationId),
  );

  if (context.messageAudience === "internal") {
    const staff = await User.find({
      _id: { $in: participants.map((row) => toObjectId(row.userId)) },
      isStaff: true,
    })
      .select({ _id: 1 })
      .lean<Array<{ _id: unknown }>>();

    const staffIds = new Set(staff.map((row: { _id: unknown }) => String(row._id)));
    return participants.filter((row) => staffIds.has(row.userId));
  }

  return participants;
}

/* ────────────────────────────────────────────── shared */

async function users(ids: string[], organizationId?: string): Promise<Recipient[]> {
  if (ids.length === 0) return [];

  const rows = await User.find({
    _id: { $in: ids.map((id) => toObjectId(id)) },
    deletedAt: null,
  })
    .select({ _id: 1, email: 1, name: 1 })
    .lean<Array<{ _id: unknown; email: string; name?: string }>>();

  return rows.map((row) => ({
    userId: String(row._id),
    email: row.email,
    ...(row.name ? { name: row.name } : {}),
    ...(organizationId ? { organizationId } : {}),
  }));
}

/** The organisation's display name, for an email that reads like a person. */
export async function organizationName(organizationId: string): Promise<string | undefined> {
  const org = await Organization.findById(toObjectId(organizationId))
    .select({ name: 1 })
    .lean<{ name: string }>();
  return org?.name;
}

/** Exported for the message handler, which needs the sender to exclude them. */
export async function messageSender(messageId: string): Promise<string | undefined> {
  const message = await Message.findById(toObjectId(messageId))
    .select({ senderUserId: 1 })
    .lean<{ senderUserId: unknown }>();
  return message ? String(message.senderUserId) : undefined;
}
