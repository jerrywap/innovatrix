import type { ClientSession } from "mongoose";
import { BaseRepository } from "./base";
import { isDuplicateKeyError, toObjectId } from "@/lib/db/base";
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

    try {
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
    } catch (error) {
      /*
       * An upsert is **not** atomic against a unique index.
       *
       * Two concurrent upserts can both fail to match, both attempt the insert, and the
       * loser gets E11000 — this is documented MongoDB behaviour, and the remedy it
       * prescribes is to treat the duplicate as "somebody else created it" and read theirs.
       * The upsert above already stops the *second conversation*; this stops the second
       * poster seeing a 500 while it does so.
       *
       * The suite's "two people post at once" test caught this intermittently, which is the
       * worst way for it to appear: it passes in isolation, fails under a loaded run, and
       * reads as a flake rather than as the race it is.
       */
      if (isDuplicateKeyError(error)) {
        const raced = await this.model
          .findOne(filter)
          .session(input.session ?? null)
          .lean<ConversationDoc>();
        if (raced) return raced;
      }
      throw error;
    }
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

/**
 * Who is reading — vendor ticket 13 made this three, not two.
 *
 * A union rather than a boolean, because the third audience is what forced the question: a
 * vendor sees `customer` and `vendor` messages and never an `internal` one, and a boolean
 * "isStaff" cannot express that.
 */
export type MessageAudience = "customer" | "vendor" | "staff";

/**
 * The §37 boundary, as a query fragment.
 *
 * | Audience | Sees |
 * |---|---|
 * | customer | `customer` |
 * | vendor | `customer`, `vendor` |
 * | staff | everything |
 *
 * One function, used by both the thread read and the unread count, so the two cannot disagree —
 * which matters because a note bumping a customer's unread count tells them a note exists even
 * if they never see it.
 */
function visibilityFilter(audience: MessageAudience): Record<string, unknown> {
  if (audience === "customer") return { visibility: "customer" };
  if (audience === "vendor") return { visibility: { $in: ["customer", "vendor"] } };
  return {};
}

export class MessageRepository extends BaseRepository<MessageDoc> {
  /**
   * **The audience is not optional.** A caller that forgets it does not get
   * everything by default — TypeScript refuses the call.
   */
  async listForConversation(input: {
    conversationId: string;
    audience: MessageAudience;
    limit?: number;
  }): Promise<MessageDoc[]> {
    return this.model
      .find({
        conversationId: toObjectId(input.conversationId),
        // Layer 1. In the query, not after it — see `visibilityFilter`.
        ...visibilityFilter(input.audience),
      })
      .sort({ createdAt: 1 })
      .limit(input.limit ?? 200)
      .lean<MessageDoc[]>();
  }

  /** Unread, for the badge. Same audience rule — a customer never counts an internal note. */
  async countUnread(input: {
    conversationIds: readonly string[];
    userId: string;
    audience: MessageAudience;
  }): Promise<number> {
    if (input.conversationIds.length === 0) return 0;

    return this.model.countDocuments({
      conversationId: { $in: input.conversationIds.map((id) => toObjectId(id)) },
      ...visibilityFilter(input.audience),
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
    audience: MessageAudience;
  }): Promise<void> {
    await this.model.updateMany(
      {
        conversationId: toObjectId(input.conversationId),
        // The same filter as the read. Marking a message read that this audience cannot see
        // would put their id on a note they never got — a small thing that makes an audit of
        // "who has read this" wrong.
        ...visibilityFilter(input.audience),
        readByUserIds: { $ne: toObjectId(input.userId) },
      },
      { $addToSet: { readByUserIds: toObjectId(input.userId) } },
    );
  }
}

export const conversations = new ConversationRepository(Conversation);
export const messages = new MessageRepository(Message);
