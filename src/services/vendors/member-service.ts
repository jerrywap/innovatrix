import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase, supportsTransactions } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { User } from "@/lib/db/models/identity";
import {
  Vendor,
  VendorInvitation,
  VendorMember,
  type VendorInvitationDoc,
  type VendorMemberDoc,
} from "@/lib/db/models/vendors";
import type { VendorRole } from "@/lib/db/enums";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { writeAuditLog, type AuditActor } from "@/services/audit";

/**
 * Vendor team membership — vendor ticket 03.
 *
 * Two roles: `owner` holds the payout account, the agreement and this list;
 * `member` holds everything else. Only one separation is load-bearing here, and
 * it is where the money goes.
 *
 * ## Invitations are ours, not Better Auth's
 *
 * Better Auth owns `organizationInvitations` and `acceptInvitation`, and both are
 * org-scoped — a vendor is deliberately not an `Organization`, so that flow
 * cannot be reused as it stands. This mirrors its shape in a collection we own.
 *
 * The invitation `_id` is the link, exactly as the org invitation's is. It is not
 * a bearer token in either system: the real check is that the invitation's email
 * matches the **verified** email on the accepting session. An unguessable id
 * plus an identity check is the whole mechanism, so no HMAC is involved.
 */

const INVITATION_TTL_HOURS = 48;

export interface VendorMemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: VendorRole;
  status: string;
  acceptedAt?: Date;
}

export async function listMembers(vendorId: string): Promise<VendorMemberRow[]> {
  await connectToDatabase();

  const members = await VendorMember.find({ vendorId: toObjectId(vendorId) })
    .sort({ createdAt: 1 })
    .limit(100)
    .lean<VendorMemberDoc[]>();

  // One batched lookup rather than one per row.
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } })
    .select({ name: 1, email: 1 })
    .lean<{ _id: unknown; name?: string; email: string }[]>();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return members.map((member) => {
    const user = byId.get(String(member.userId));
    return {
      id: String(member._id),
      userId: String(member.userId),
      name: user?.name ?? "—",
      email: user?.email ?? "—",
      role: member.role,
      status: member.status,
      ...(member.acceptedAt ? { acceptedAt: member.acceptedAt } : {}),
    };
  });
}

export interface PendingInvitationRow {
  id: string;
  email: string;
  role: VendorRole;
  expiresAt: Date;
}

export async function listPendingInvitations(
  vendorId: string,
): Promise<PendingInvitationRow[]> {
  await connectToDatabase();

  const rows = await VendorInvitation.find({
    vendorId: toObjectId(vendorId),
    status: "pending",
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean<VendorInvitationDoc[]>();

  return rows.map((row) => ({
    id: String(row._id),
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
  }));
}

/**
 * Invite somebody to this vendor.
 *
 * Refuses an address that already has an active membership *anywhere* — the
 * one-vendor-per-user constraint, checked here so the inviter is told rather than
 * discovering it when the invitee cannot accept. It is checked again at
 * acceptance, because the invitee's situation may change in between and the
 * check that matters is the later one.
 */
export async function invite(
  vendorId: string,
  input: { email: string; role: VendorRole },
  actor: AuditActor & { userId?: string },
): Promise<VendorInvitationDoc> {
  await connectToDatabase();

  if (!("userId" in actor) || !actor.userId) {
    throw new ValidationError("An invitation must name who sent it.");
  }

  const email = input.email.trim().toLowerCase();

  const existingUser = await User.findOne({ email, deletedAt: null }).select({ _id: 1 }).lean();
  if (existingUser) {
    const already = await VendorMember.findOne({
      userId: existingUser._id,
      status: "active",
    }).lean();

    if (already) {
      throw new ConflictError(
        String(already.vendorId) === vendorId
          ? "They are already a member of this vendor."
          : "That person already belongs to another vendor account.",
      );
    }
  }

  const pending = await VendorInvitation.findOne({
    vendorId: toObjectId(vendorId),
    email,
    status: "pending",
  }).lean();

  if (pending) {
    throw new ConflictError("There is already an open invitation to that address.");
  }

  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);

  const [invitation] = await VendorInvitation.create([
    {
      vendorId: toObjectId(vendorId),
      email,
      role: input.role,
      status: "pending" as const,
      invitedByUserId: toObjectId(actor.userId),
      expiresAt,
    },
  ]);

  if (!invitation) throw new Error("VendorInvitation.create returned nothing.");

  await writeAuditLog({
    action: "vendor_member.invited",
    actor,
    subject: { type: "vendor", id: vendorId },
    // The address, not a token, and never the invitation id — an audit row is
    // not a place to leave something that grants access.
    after: { email, role: input.role, expiresAt },
    source: "vendor",
  });

  return invitation.toObject() as VendorInvitationDoc;
}

export interface InvitationView {
  id: string;
  vendorId: string;
  vendorName: string;
  email: string;
  role: VendorRole;
  expiresAt: Date;
}

/**
 * An invitation for the accept page to render, or null.
 *
 * Returns null for expired and already-accepted invitations alike: a link that
 * has been spent looks exactly like one that never existed, which is the same
 * position `resetPasswordAction` takes.
 */
export async function findOpenInvitation(invitationId: string): Promise<InvitationView | null> {
  await connectToDatabase();

  const invitation = await VendorInvitation.findOne({
    _id: toObjectId(invitationId),
    status: "pending",
  }).lean<VendorInvitationDoc>();

  if (!invitation) return null;
  if (invitation.expiresAt.getTime() <= Date.now()) return null;

  const vendor = await Vendor.findOne({ _id: invitation.vendorId, deletedAt: null })
    .select({ displayName: 1 })
    .lean<{ _id: unknown; displayName: string }>();

  if (!vendor) return null;

  return {
    id: String(invitation._id),
    vendorId: String(invitation.vendorId),
    vendorName: vendor.displayName,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Accept an invitation.
 *
 * Four things must hold, and all four are checked here rather than in the page:
 * the invitation is open, it has not expired, the accepting email **matches** it,
 * and that email is verified. The last is the platform's own rule (§75) and more
 * so here — a member is one promotion away from the payout account.
 *
 * The membership write and the invitation's status move together, so a race
 * between two clicks cannot produce a member with a still-open invitation.
 */
export async function acceptInvitation(
  invitationId: string,
  user: { id: string; email: string; emailVerified: boolean; name?: string },
): Promise<VendorMemberDoc> {
  await connectToDatabase();

  if (!user.emailVerified) {
    throw new ForbiddenError("Confirm your email address before joining a vendor account.");
  }

  const invitation = await VendorInvitation.findOne({
    _id: toObjectId(invitationId),
    status: "pending",
  }).lean<VendorInvitationDoc>();

  if (!invitation) throw new NotFoundError("invitation", { id: invitationId });

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError("That invitation has expired. Ask for a new one.");
  }

  if (invitation.email !== user.email.trim().toLowerCase()) {
    throw new ForbiddenError("That invitation was sent to a different email address.");
  }

  const already = await VendorMember.findOne({ userId: user.id, status: "active" }).lean();
  if (already) {
    throw new ConflictError(
      String(already.vendorId) === String(invitation.vendorId)
        ? "You are already a member of this vendor."
        : "You already belong to another vendor account.",
    );
  }

  const write = async (session?: ClientSession) => {
    const claimed = await VendorInvitation.findOneAndUpdate(
      { _id: invitation._id, status: "pending" },
      { $set: { status: "accepted", acceptedAt: new Date() } },
      { returnDocument: "after", ...(session ? { session } : {}) },
    ).lean<VendorInvitationDoc>();

    if (!claimed) {
      throw new ConflictError("That invitation was just used or withdrawn.");
    }

    const [member] = await VendorMember.create(
      [
        {
          vendorId: invitation.vendorId,
          userId: toObjectId(user.id),
          role: invitation.role,
          status: "active" as const,
          invitedByUserId: invitation.invitedByUserId,
          acceptedAt: new Date(),
        },
      ],
      session ? { session } : {},
    );

    if (!member) throw new Error("VendorMember.create returned nothing.");

    await writeAuditLog(
      {
        action: "vendor_member.joined",
        actor: {
          type: "vendor",
          userId: user.id,
          vendorId: String(invitation.vendorId),
          ...(user.name ? { name: user.name } : {}),
        },
        subject: { type: "vendor", id: String(invitation.vendorId) },
        after: { email: invitation.email, role: invitation.role },
        source: "vendor",
      },
      session,
    );

    return member.toObject() as VendorMemberDoc;
  };

  return supportsTransactions() ? withTransaction(write) : write();
}

/** Withdraw an open invitation. */
export async function revokeInvitation(
  vendorId: string,
  invitationId: string,
  actor: AuditActor,
): Promise<void> {
  await connectToDatabase();

  const updated = await VendorInvitation.findOneAndUpdate(
    { _id: toObjectId(invitationId), vendorId: toObjectId(vendorId), status: "pending" },
    { $set: { status: "revoked" } },
  ).lean<VendorInvitationDoc>();

  if (!updated) throw new NotFoundError("invitation", { id: invitationId });

  await writeAuditLog({
    action: "vendor_member.invitation_revoked",
    actor,
    subject: { type: "vendor", id: vendorId },
    after: { email: updated.email },
    source: "vendor",
  });
}

/**
 * Remove a member's access.
 *
 * The last owner cannot be removed. An account with no owner has payout details
 * nobody may change and nobody who can accept a new agreement version, and there
 * is no screen from which to fix it.
 *
 * `revoked` rather than deleted, so the history of who had access survives — and
 * because the partial unique index on `userId` only covers `active` rows, a
 * revoked person can join a different vendor later.
 */
export async function revokeMember(
  vendorId: string,
  memberId: string,
  actor: AuditActor,
): Promise<void> {
  await connectToDatabase();

  const member = await VendorMember.findOne({
    _id: toObjectId(memberId),
    vendorId: toObjectId(vendorId),
  }).lean<VendorMemberDoc>();

  if (!member) throw new NotFoundError("member", { id: memberId });

  if (member.role === "owner") {
    throw new ValidationError(
      "The owner cannot be removed. Transfer ownership to somebody else first.",
    );
  }

  await VendorMember.updateOne({ _id: member._id }, { $set: { status: "revoked" } });

  await writeAuditLog({
    action: "vendor_member.revoked",
    actor,
    subject: { type: "vendor", id: vendorId },
    before: { userId: String(member.userId), role: member.role, status: member.status },
    after: { status: "revoked" },
    source: "vendor",
  });
}

/**
 * Hand ownership to another active member.
 *
 * One action, not two: promote them and demote yourself in a single transaction,
 * because the intermediate states — two owners, or none — are each a bug somebody
 * would otherwise have to clean up by hand.
 */
export async function transferOwnership(
  vendorId: string,
  toMemberId: string,
  currentOwnerUserId: string,
  actor: AuditActor,
): Promise<void> {
  await connectToDatabase();

  const target = await VendorMember.findOne({
    _id: toObjectId(toMemberId),
    vendorId: toObjectId(vendorId),
    status: "active",
  }).lean<VendorMemberDoc>();

  if (!target) throw new NotFoundError("member", { id: toMemberId });
  if (String(target.userId) === currentOwnerUserId) {
    throw new ValidationError("You already own this vendor account.");
  }

  const write = async (session?: ClientSession) => {
    const promoted = await VendorMember.updateOne(
      { _id: target._id, status: "active" },
      { $set: { role: "owner" } },
      session ? { session } : {},
    );

    if (promoted.modifiedCount !== 1) {
      throw new ConflictError(
        "That member's access changed while you were transferring. Reload.",
      );
    }

    await VendorMember.updateOne(
      { vendorId: toObjectId(vendorId), userId: toObjectId(currentOwnerUserId) },
      { $set: { role: "member" } },
      session ? { session } : {},
    );

    await writeAuditLog(
      {
        action: "vendor_member.ownership_transferred",
        actor,
        subject: { type: "vendor", id: vendorId },
        // Both parties named — a transfer is the change somebody asks about later.
        before: { ownerUserId: currentOwnerUserId },
        after: { ownerUserId: String(target.userId) },
        source: "vendor",
      },
      session,
    );
  };

  await (supportsTransactions() ? withTransaction(write) : write());
}
