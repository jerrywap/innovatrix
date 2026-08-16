import type { ClientSession } from "mongoose";
import { BaseRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import type { ConversationSubjectType } from "@/lib/db/enums";
import {
  Conversation,
  Message,
  type ConversationDoc,
  type MessageDoc,
} from "@/lib/db/models/communication";

/**
 * Conversations and messages — §38, and §37's boundary.
 *
 * ## Layer 1 of four: the filter is in the query
 *
 * §37 is the hardest requirement in ticket 21 — *internal messages must never
 * be exposed to customers* — and it is treated as a security boundary rather
 * than a UI preference. The defence has four layers and this is the first:
 *
 *   1. **here** — `listMessages` takes an `audience` and, for a customer, puts
 *      `visibility: "customer"` **into the query**. Not a `.filter()` after the
 *      read. A filter in application code is one early `return` away from being
 *      skipped, and the bug is silent.
 *   2. the service exposes a customer-facing function that cannot pass
 *      `audience: "staff"`,
 *   3. the customer DTO has no field that could carry an internal message,
 *   4. a test asserts internal messages are absent from every customer payload.
 *
 * `messages` carries `{conversationId, visibility, createdAt}`, so the
 * customer's read is an index scan rather than a filtered collection read —
 * the safe version is also the fast one.
 */
export class ConversationRepository extends BaseRepository<ConversationDoc> {
  /** One conversation per subject in MVP, created on first message. */
  async findOrCreateForSubject(input: {
    organizationId: string;
    subjectType: ConversationSubjectType;
    subjectId: string;
    participantUserIds?: readonly string[];
    session?: ClientSession;
  }): Promise<ConversationDoc> {
    const filter = {
      organizationId: toObjectId(input.organizationId),
      subjectType: input.subjectType,
      subjectId: toObjectId(input.subjectId),
    };

    const existing = await this.model
      .findOne(filter)
      .session(input.session ?? null)
      .lean<ConversationDoc>();
    if (existing) return existing;

    const created = await this.model
      .findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            ...filter,
            participantUserIds: (input.participantUserIds ?? []).map((id) => toObjectId(id)),
          },
        },
        // Upsert rather than `create`: two people replying at once would
        // otherwise make two conversations for one subject, and the second
        // thread is invisible to whoever is reading the first.
        { upsert: true, returnDocument: "after", session: input.session ?? null },
      )
      .lean<ConversationDoc>();

    return created!;
  }

  async findForSubject(
    organizationId: string,
    subjectType: ConversationSubjectType,
    subjectId: string,
  ): Promise<ConversationDoc | null> {
    return this.model
      .findOne({
        organizationId: toObjectId(organizationId),
        subjectType,
        subjectId: toObjectId(subjectId),
      })
      .lean<ConversationDoc>();
  }
}

export class MessageRepository extends BaseRepository<MessageDoc> {
  /**
   * **The audience is not optional.** A caller that forgets it does not get
   * everything by default — TypeScript refuses the call.
   */
  async listForConversation(input: {
    conversationId: string;
    audience: "customer" | "staff";
    limit?: number;
  }): Promise<MessageDoc[]> {
    return this.model
      .find({
        conversationId: toObjectId(input.conversationId),
        // Layer 1. In the query, not after it.
        ...(input.audience === "customer" ? { visibility: "customer" } : {}),
      })
      .sort({ createdAt: 1 })
      .limit(input.limit ?? 200)
      .lean<MessageDoc[]>();
  }

  /** Unread, for the badge. Same audience rule — a customer never counts an internal note. */
  async countUnread(input: {
    conversationIds: readonly string[];
    userId: string;
    audience: "customer" | "staff";
  }): Promise<number> {
    if (input.conversationIds.length === 0) return 0;

    return this.model.countDocuments({
      conversationId: { $in: input.conversationIds.map((id) => toObjectId(id)) },
      ...(input.audience === "customer" ? { visibility: "customer" } : {}),
      // Your own message is not unread to you.
      senderUserId: { $ne: toObjectId(input.userId) },
      readByUserIds: { $ne: toObjectId(input.userId) },
    });
  }

  /**
   * Mark everything this reader may see as read.
   *
   * `$addToSet`, so reading twice is one entry and two devices racing produce
   * the same result as one — which is what "unread counts are accurate after
   * reading on another device" means in practice.
   */
  async markRead(input: {
    conversationId: string;
    userId: string;
    audience: "customer" | "staff";
  }): Promise<void> {
    await this.model.updateMany(
      {
        conversationId: toObjectId(input.conversationId),
        ...(input.audience === "customer" ? { visibility: "customer" } : {}),
        readByUserIds: { $ne: toObjectId(input.userId) },
      },
      { $addToSet: { readByUserIds: toObjectId(input.userId) } },
    );
  }
}

export const conversations = new ConversationRepository(Conversation);
export const messages = new MessageRepository(Message);
