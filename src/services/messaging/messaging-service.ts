import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { ConversationSubjectType, MessageVisibility } from "@/lib/db/enums";
import { Conversation, Message } from "@/lib/db/models/communication";
import { User } from "@/lib/db/models/identity";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { conversations, messages } from "@/repositories/conversation.repository";
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
  audience: "customer" | "staff";
}): Promise<CustomerMessage[] | StaffMessage[]> {
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
  })) as CustomerMessage[] | StaffMessage[];
}

/* ────────────────────────────────────────────── writes */

export interface PostInput {
  organizationId: string;
  subjectType: ConversationSubjectType;
  subjectId: string;
  senderUserId: string;
  senderType: "customer" | "staff";
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

  const visibility: MessageVisibility =
    input.senderType === "customer" ? "customer" : input.visibility;

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
