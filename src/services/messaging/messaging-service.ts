import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { ConversationSubjectType, MessageVisibility } from "@/lib/db/enums";
import { Conversation, Message, type ConversationDoc } from "@/lib/db/models/communication";
import { CustomerRequest } from "@/lib/db/models/requests";
import { formatDateTime } from "@/lib/dates";
import { User } from "@/lib/db/models/identity";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  conversations,
  messages,
  type MessageAudience,
} from "@/repositories/conversation.repository";
import { emit } from "@/lib/events";

/**
 * Messaging — §38, §37.
 *
 * ## Layers 2 and 3 of the visibility boundary
 *
 * The repository puts `visibility: "customer"` into the query (layer 1). Here:
 *
 * - **Layer 2** — `customerThread()` and `staffThread()` are separate exported
 *   functions. The customer-facing one takes no audience parameter, so a
 *   customer-facing caller has no way to ask for internal messages. There is no
 *   `audience` argument to get wrong.
 * - **Layer 3** — `CustomerMessage` has **no `visibility` field**. The type
 *   cannot express an internal message, so one cannot be serialised into a
 *   customer payload even by a mistake that gets past the first two layers.
 *
 * §37 calls this a security boundary rather than a UI preference, and the
 * reason is the failure mode: a customer reading staff deliberation about their
 * own request is not a rendering bug, it is a disclosure.
 */

/* ────────────────────────────────────────────── DTOs */

/**
 * What a customer may see. Note what is missing: `visibility`.
 *
 * Adding it "for completeness" would defeat layer 3. If a future reader wants
 * to know why the field is absent, this is why.
 */
export interface CustomerMessage {
  id: string;
  senderType: "customer" | "staff" | "system";
  senderName?: string;
  body: string;
  at: string;
  attachments: Array<{ index: number; filename: string; sizeBytes?: number }>;
  mine: boolean;
}

/**
 * What a **vendor** sees — vendor ticket 13.
 *
 * A separate type with no `visibility` field, for exactly the reason `CustomerMessage` has none:
 * layer 3. A vendor may read `customer` and `vendor` messages and must never read an `internal`
 * one, and a type that cannot express an internal message cannot serialise one into a vendor's
 * payload even if the query filter were got wrong.
 *
 * It is not `CustomerMessage` under another name, because the two audiences see different sets
 * and one type for both would be a type that lies to one of them.
 */
export interface VendorMessage extends CustomerMessage {
  /** Whether this message is also visible to the customer. The vendor needs to know. */
  visibleToCustomer: boolean;
}

/** What staff see. Carries `visibility`, because staff must know which is which. */
export interface StaffMessage extends CustomerMessage {
  visibility: MessageVisibility;
}

/* ────────────────────────────────────────────── reads */

export async function customerThread(input: {
  organizationId: string;
  subjectType: ConversationSubjectType;
  subjectId: string;
  viewerUserId: string;
}): Promise<CustomerMessage[]> {
  return thread({ ...input, audience: "customer" });
}

/**
 * The thread as the vendor reads it — vendor ticket 13.
 *
 * Its own exported function, like `customerThread` and `staffThread`, so a vendor-facing caller
 * has **no audience parameter to get wrong**. That is layer 2 of §37's boundary, and adding a
 * third audience is exactly the change that would have broken it if the audience were an
 * argument threaded through from a page.
 */
export async function vendorThread(input: {
  organizationId: string;
  subjectType: ConversationSubjectType;
  subjectId: string;
  viewerUserId: string;
}): Promise<VendorMessage[]> {
  return thread({ ...input, audience: "vendor" }) as Promise<VendorMessage[]>;
}

export async function staffThread(input: {
  organizationId: string;
  subjectType: ConversationSubjectType;
  subjectId: string;
  viewerUserId: string;
}): Promise<StaffMessage[]> {
  return thread({ ...input, audience: "staff" }) as Promise<StaffMessage[]>;
}

async function thread(input: {
  organizationId: string;
  subjectType: ConversationSubjectType;
  subjectId: string;
  viewerUserId: string;
  audience: MessageAudience;
}): Promise<CustomerMessage[] | VendorMessage[] | StaffMessage[]> {
  await connectToDatabase();

  const conversation = await conversations.findForSubject(
    input.organizationId,
    input.subjectType,
    input.subjectId,
  );
  if (!conversation) return [];

  const rows = await messages.listForConversation({
    conversationId: String(conversation._id),
    audience: input.audience,
  });

  const senders = await User.find({
    _id: {
      $in: rows
        .map((row) => row.senderUserId)
        .filter((id): id is NonNullable<typeof id> => Boolean(id)),
    },
  })
    .select({ name: 1 })
    .lean<{ _id: unknown; name?: string }[]>();
  const nameById = new Map(senders.map((user) => [String(user._id), user.name ?? "Someone"]));

  return rows.map((row) => ({
    id: String(row._id),
    senderType: row.senderType,
    ...(row.senderUserId
      ? {
          // Staff are shown by name to the customer — §37 wants a person, not
          // "Support". Nothing else about them travels.
          senderName: nameById.get(String(row.senderUserId)) ?? "Someone",
        }
      : {}),
    body: row.body,
    at: new Date((row as unknown as { createdAt: Date }).createdAt).toISOString(),
    attachments: (row.attachments ?? []).map((attachment, position) => ({
      // Position within the message, like request attachments — the storage key
      // is not a handle a browser gets to hold.
      index: position,
      filename: attachment.filename ?? "file",
      ...(attachment.sizeBytes ? { sizeBytes: attachment.sizeBytes } : {}),
    })),
    mine: Boolean(row.senderUserId) && String(row.senderUserId) === input.viewerUserId,
    // Layer 3 in practice: this spread is the *only* place `visibility` can
    // enter a DTO, and it cannot fire for a customer.
    ...(input.audience === "staff" ? { visibility: row.visibility } : {}),
    /*
     * A vendor gets a *derived boolean*, not the field — vendor ticket 13.
     *
     * They genuinely need to know whether the customer can see a message (it changes what they
     * write next), and "customer or not" is the whole of what they need. Handing them
     * `visibility` would put `"internal"` in the type of a payload that must never carry one.
     */
    ...(input.audience === "vendor"
      ? { visibleToCustomer: row.visibility === "customer" }
      : {}),
  })) as CustomerMessage[] | VendorMessage[] | StaffMessage[];
}

/* ────────────────────────────────────────────── writes */

export interface PostInput {
  organizationId: string;
  subjectType: ConversationSubjectType;
  subjectId: string;
  senderUserId: string;
  senderType: "customer" | "staff" | "vendor";
  body: string;
  visibility: MessageVisibility;
  attachments?: Array<{
    storageKey: string;
    filename?: string;
    contentType?: string;
    sizeBytes?: number;
  }>;
  /**
   * The human reference of the thing being discussed — `REQ-2026-0001`.
   *
   * Passed in rather than looked up: the caller has already loaded the subject
   * to authorise the post, and this is only used for a notification title.
   * Absent falls back to the id, which is ugly but never wrong.
   */
  subjectReference?: string;
}

export interface PostResult {
  conversationId: string;
  messageId: string;
}

/**
 * Post a message.
 *
 * ## A customer cannot post internally, whatever they send
 *
 * The visibility is **forced** to `customer` for a customer sender rather than
 * validated and rejected. A customer has no legitimate reason to post an
 * internal note, so the safest reading of `visibility: "internal"` arriving on
 * a customer request is "somebody is probing" — and coercing is one fewer
 * branch than refusing, with no case where refusing would have been better.
 */
export async function postMessage(input: PostInput): Promise<PostResult> {
  await connectToDatabase();

  if (input.body.trim().length === 0) {
    throw new ForbiddenError("A message needs something in it.");
  }

  /*
   * What each sender is *allowed* to choose.
   *
   * - A **customer** is forced to `customer`. They have no legitimate reason to post an
   *   internal note, so the safest reading of `visibility: "internal"` arriving from one is
   *   "somebody is probing" — and coercing is one fewer branch than refusing.
   * - A **vendor** may choose `customer` (answering the buyer) or `vendor` (a note to us), and
   *   `internal` is coerced to `vendor`. Vendor ticket 13 made `internal` mean staff-only, and
   *   that now includes hiding it from the vendor — so a vendor writing one would be writing a
   *   note they could not then read.
   * - **Staff** choose freely; that is the point of the field.
   */
  const visibility: MessageVisibility =
    input.senderType === "customer"
      ? "customer"
      : input.senderType === "vendor"
        ? input.visibility === "customer"
          ? "customer"
          : "vendor"
        : input.visibility;

  const conversation = await conversations.findOrCreateForSubject({
    organizationId: input.organizationId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    participantUserIds: [input.senderUserId],
  });

  const created = await Message.create({
    conversationId: conversation._id,
    organizationId: toObjectId(input.organizationId),
    senderType: input.senderType,
    senderUserId: toObjectId(input.senderUserId),
    body: input.body.trim(),
    visibility,
    attachments: input.attachments ?? [],
    // The sender has read their own message. Without this, everyone's unread
    // badge includes what they just wrote.
    readByUserIds: [toObjectId(input.senderUserId)],
  });

  /*
   * `lastCustomerMessageAt` / `lastStaffMessageAt` exist so the §31 counters
   * never scan the message collection. Only a **customer-visible** staff reply
   * counts as us having replied — an internal note is not an answer, and
   * letting it clear the "awaiting staff response" flag would hide a customer
   * still waiting.
   */
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessageAt: new Date(),
        ...(input.senderType === "customer"
          ? { lastCustomerMessageAt: new Date() }
          : visibility === "customer"
            ? { lastStaffMessageAt: new Date() }
            : {}),
      },
      /*
       * Vendor ticket 13's SLA measurement, stamped **once**.
       *
       * `$setOnInsert` cannot be used on an update, so `$min` does the job: the earliest
       * customer-visible vendor reply wins, and a second reply cannot move the figure. Only a
       * customer-visible reply counts — a note to us is not an answer to the buyer, and letting
       * it stop the clock would report a response time nobody experienced.
       */
      ...(input.senderType === "vendor" && visibility === "customer"
        ? { $min: { firstVendorResponseAt: new Date() } }
        : {}),
      $addToSet: { participantUserIds: toObjectId(input.senderUserId) },
    },
  );

  /*
   * After the writes, and carrying the **audience** rather than the body.
   *
   * §37: an internal note must never reach a customer, and a notification is
   * somewhere a body could leak to a recipient who cannot open the thread. So
   * the event says who may hear that something was said and where to look; the
   * words stay behind the thread's own authorisation.
   */
  await emit("MessagePosted", {
    conversationId: String(conversation._id),
    messageId: String(created._id),
    organizationId: input.organizationId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectReference: input.subjectReference ?? input.subjectId,
    senderUserId: input.senderUserId,
    audience: visibility === "internal" ? "internal" : "customer",
  });

  return { conversationId: String(conversation._id), messageId: String(created._id) };
}

/* ────────────────────────────────────────────── read state */

export async function markThreadRead(input: {
  organizationId: string;
  subjectType: ConversationSubjectType;
  subjectId: string;
  userId: string;
  audience: "customer" | "staff";
}): Promise<void> {
  await connectToDatabase();

  const conversation = await conversations.findForSubject(
    input.organizationId,
    input.subjectType,
    input.subjectId,
  );
  if (!conversation) return;

  await messages.markRead({
    conversationId: String(conversation._id),
    userId: input.userId,
    audience: input.audience,
  });
}

export interface ConversationSummary {
  id: string;
  subjectType: ConversationSubjectType;
  subjectId: string;
  /** `REQ-2026-0001` — what the customer recognises. */
  reference: string;
  title: string;
  /** The last message this reader is allowed to have seen. */
  excerpt: string;
  lastAt: string;
  unread: number;
}

/**
 * Every thread this reader has, newest activity first — the inbox.
 *
 * ## Why there was none
 *
 * `/dashboard/messages` rendered a hardcoded "No messages" and performed no
 * query at all, so it said that however many conversations existed. Every real
 * thread was reachable only from inside its subject page. This is the
 * aggregation that was missing; nothing else about ticket 21 changes.
 *
 * ## The §37 boundary, in the query
 *
 * The excerpt and the unread count both come from the **same audience filter**
 * the thread view uses — `visibility: "customer"` for a customer, in the query
 * rather than after it. That matters more here than in a thread: an internal
 * note surfacing as a customer's "last message" would leak deliberation into a
 * list, and a note bumping their unread count would tell them a note exists.
 *
 * ## An index, not a second chat
 *
 * It links into the subject. A thread belongs beside the request it is about
 * (§101); lifting it out of that context is how the reply loses the thing it
 * was replying to.
 */
export async function listConversations(input: {
  organizationId: string;
  userId: string;
  limit?: number;
}): Promise<ConversationSummary[]> {
  return inbox({ ...input, audience: "customer" });
}

/**
 * The same inbox, across every organisation — §30.
 *
 * Named rather than an optional `organizationId`, for the reason the customer
 * order loader is a separate function too: the scoped and the unscoped call
 * must not be one argument apart. Staff reading across organisations is
 * legitimate and is authorised by `message.view_all` at the page.
 */
export async function listConversationsForStaff(input: {
  userId: string;
  limit?: number;
}): Promise<ConversationSummary[]> {
  return inbox({ ...input, audience: "staff" });
}

async function inbox(input: {
  organizationId?: string;
  userId: string;
  audience: MessageAudience;
  limit?: number;
}): Promise<ConversationSummary[]> {
  await connectToDatabase();

  const rows = await Conversation.find({
    ...(input.organizationId ? { organizationId: toObjectId(input.organizationId) } : {}),
  })
    .sort({ lastMessageAt: -1 })
    .limit(input.limit ?? 50)
    .lean<ConversationDoc[]>();

  if (rows.length === 0) return [];

  /*
   * Subjects, resolved in one query rather than per row.
   *
   * A conversation stores only `subjectType` and `subjectId` — §38's
   * polymorphic shape — so the reference and title a reader recognises live on
   * the subject. Only `request` is ever written today; the map is keyed by id
   * so adding `order` or `quote` is another lookup here, not a rewrite.
   */
  const requestIds = rows
    .filter((row) => row.subjectType === "request")
    .map((row) => row.subjectId);

  const subjects = new Map<string, { reference: string; title: string }>();
  if (requestIds.length > 0) {
    const found = await CustomerRequest.find({ _id: { $in: requestIds } })
      .select({ reference: 1, title: 1 })
      .lean<Array<{ _id: unknown; reference: string; title?: string }>>();
    for (const subject of found) {
      subjects.set(String(subject._id), {
        reference: subject.reference,
        title: subject.title ?? subject.reference,
      });
    }
  }

  /*
   * Vendor support threads — vendor ticket 13, and the reason the map above is keyed by id.
   *
   * §38 and §101: a customer should not have to work out which of three parties owns their problem
   * before they can ask about it, so their request threads, order threads and vendor threads are
   * one inbox. The subject is an entitlement, so the recognisable label is the **product name** —
   * "Northwind Dispatch" is what the customer thinks they are asking about, not an entitlement id.
   */
  const supportIds = rows
    .filter((row) => row.subjectType === "vendor_support")
    .map((row) => row.subjectId);

  if (supportIds.length > 0) {
    const { Entitlement } = await import("@/lib/db/models/commerce");
    const { Product } = await import("@/lib/db/models/catalog");

    const entitlements = await Entitlement.find({ _id: { $in: supportIds } })
      .select({ productId: 1 })
      .lean<Array<{ _id: unknown; productId: import("mongoose").Types.ObjectId }>>();

    const products = await Product.find({
      _id: { $in: entitlements.map((row) => row.productId) },
    })
      .select({ name: 1 })
      .lean<Array<{ _id: unknown; name: string }>>();
    const nameById = new Map(products.map((row) => [String(row._id), row.name]));

    for (const row of entitlements) {
      const name = nameById.get(String(row.productId));
      if (!name) continue;
      subjects.set(String(row._id), { reference: name, title: `Support · ${name}` });
    }
  }

  const summaries = await Promise.all(
    rows.map(async (row) => {
      const [visible, unread] = await Promise.all([
        messages.listForConversation({
          conversationId: String(row._id),
          audience: input.audience,
        }),
        messages.countUnread({
          conversationIds: [String(row._id)],
          userId: input.userId,
          audience: input.audience,
        }),
      ]);

      const last = visible.at(-1);
      // A conversation whose only messages are internal has nothing to show a
      // customer — and must not appear as an empty row hinting that it exists.
      if (!last) return null;

      const subject = subjects.get(String(row.subjectId));

      return {
        id: String(row._id),
        subjectType: row.subjectType,
        subjectId: String(row.subjectId),
        reference: subject?.reference ?? "",
        title: subject?.title ?? "Conversation",
        excerpt: last.body.slice(0, 160),
        lastAt: formatDateTime(
          (last as { createdAt?: Date }).createdAt ?? row.lastMessageAt ?? new Date(),
        ),
        unread,
      } satisfies ConversationSummary;
    }),
  );

  return summaries.filter((summary): summary is ConversationSummary => summary !== null);
}

/** Unread across every conversation in an organisation — the dashboard badge. */
export async function unreadForOrganization(input: {
  organizationId: string;
  userId: string;
  audience: "customer" | "staff";
}): Promise<number> {
  await connectToDatabase();

  const rows = await Conversation.find({
    organizationId: toObjectId(input.organizationId),
  })
    .select({ _id: 1 })
    .lean<{ _id: unknown }[]>();

  return messages.countUnread({
    conversationIds: rows.map((row) => String(row._id)),
    userId: input.userId,
    audience: input.audience,
  });
}

/** An attachment's key, for the download route. Participant check is the caller's. */
export async function attachmentKeyAt(
  messageId: string,
  position: number,
): Promise<{ key: string; filename: string; contentType?: string; organizationId: string }> {
  await connectToDatabase();

  const message = await Message.findById(toObjectId(messageId)).lean<{
    organizationId: unknown;
    attachments: Array<{
      storageKey: string;
      filename?: string;
      contentType?: string;
    }>;
  }>();

  const attachment = message?.attachments?.[position];
  if (!message || !attachment?.storageKey) {
    throw new NotFoundError("attachment", { messageId, position });
  }

  return {
    key: attachment.storageKey,
    filename: attachment.filename ?? "file",
    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
    organizationId: String(message.organizationId),
  };
}
