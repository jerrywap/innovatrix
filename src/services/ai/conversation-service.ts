import "server-only";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { usesSecureCookies } from "@/config/env";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { AiContextType } from "@/lib/db/enums";
import {
  AiConversation,
  type AiConversationDoc,
  type AiMessage,
} from "@/lib/db/models/requests";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { CONVERSATION_COOKIE, conversationCookie } from "./conversation-cookie";
import { PROMPT_VERSION } from "./prompts";

/**
 * Conversations — §72, ticket 16.
 *
 * ## Who owns a conversation, and how that changes
 *
 * Before sign-in, an `anonymousKey` from an httpOnly cookie. After sign-in, a
 * `userId` and an `organizationId`. §17 requires the transfer to be lossless:
 * a visitor can start describing what they need, sign up when asked to submit,
 * and find the whole interview intact.
 *
 * That is the same shape as the cart's guest→user merge, and it uses the same
 * cookie discipline: **reading never writes**. `readAnonymousKey()` is safe in
 * a Server Component; only `ensureAnonymousKey()` sets a cookie, and it is
 * called from Server Actions and Route Handlers only.
 *
 * ## Access is a single function, and everything goes through it
 *
 * `assertCanRead` is the only place that decides. The SSE route, the page and
 * the actions all call it, so "Org A cannot read Org B's conversation" is one
 * rule rather than three copies that can drift — and the transcript is
 * evidence of what a customer agreed to (§19), which makes a leak worse than
 * an ordinary one.
 */

export { CONVERSATION_COOKIE } from "./conversation-cookie";

export async function readAnonymousKey(): Promise<string | undefined> {
  return (await cookies()).get(CONVERSATION_COOKIE)?.value;
}

/** Server Actions and Route Handlers only — setting a cookie elsewhere throws. */
export async function ensureAnonymousKey(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(CONVERSATION_COOKIE)?.value;
  if (existing) return existing;

  const key = nanoid(21);
  jar.set(conversationCookie(key, usesSecureCookies()));
  return key;
}

/* ────────────────────────────────────────────── access */

export interface Viewer {
  userId?: string;
  organizationId?: string;
  anonymousKey?: string;
  /** Staff read transcripts as evidence (§19), across organisations. */
  isStaff?: boolean;
}

/**
 * May this viewer read this conversation?
 *
 * Deliberately throws `NotFoundError` rather than `ForbiddenError` for the
 * cross-organisation case: a stranger should not learn that a conversation id
 * is real. `ForbiddenError` is reserved for the one case where the viewer
 * plainly knows it exists — their own, in another organisation they have since
 * left — which does not arise yet but would read wrong as a 404.
 */
export function assertCanRead(conversation: AiConversationDoc, viewer: Viewer): void {
  if (viewer.isStaff) return;

  if (conversation.organizationId) {
    if (
      viewer.organizationId &&
      String(conversation.organizationId) === viewer.organizationId
    ) {
      return;
    }
    throw new NotFoundError("conversation", { id: String(conversation._id) });
  }

  // Not yet claimed by an organisation: the cookie that started it is the only
  // credential there is.
  if (
    conversation.anonymousKey &&
    viewer.anonymousKey &&
    conversation.anonymousKey === viewer.anonymousKey
  ) {
    return;
  }

  if (conversation.userId && viewer.userId && String(conversation.userId) === viewer.userId) {
    return;
  }

  throw new NotFoundError("conversation", { id: String(conversation._id) });
}

export async function getConversation(id: string, viewer: Viewer): Promise<AiConversationDoc> {
  await connectToDatabase();

  const conversation = await AiConversation.findById(toObjectId(id)).lean<AiConversationDoc>();
  if (!conversation) throw new NotFoundError("conversation", { id });

  assertCanRead(conversation, viewer);
  return conversation;
}

/**
 * The customer's side of a conversation this one was carried over from — §24.
 *
 * ## Their turns only
 *
 * `recommend.ts` searches the catalogue on the customer's words for a stated
 * reason: the assistant's turns are full of *our* vocabulary and our guesses, so
 * matching on them matches half the catalogue. The same reasoning applies with
 * more force here. Replaying the assistant's side would let a feature it merely
 * offered — and the customer never accepted — cross into a new interview looking
 * like something they had asked for, which is exactly what §23 and §33 exist to
 * stop.
 *
 * ## Scoped, and never fatal
 *
 * The id arrives from a query string, so it is a claim rather than a fact.
 * `getConversation` is the same check the page made, run again here because a
 * second cheap check is worth more than an assumption about the caller. If it
 * fails for any reason — wrong owner, deleted, malformed — the customer simply
 * gets an interview without the background. A missing convenience must not cost
 * them their turn.
 */
export async function carriedCustomerMessages(
  conversationId: string,
  viewer: Viewer,
): Promise<string[]> {
  try {
    const source = await getConversation(conversationId, viewer);
    return source.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content.trim())
      .filter((content) => content.length > 0);
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────── lifecycle */

export interface StartInput {
  contextType: AiContextType;
  productId?: string;
  productVersionId?: string;
  productVersionNumber?: string;
  userId?: string;
  organizationId?: string;
  anonymousKey?: string;
  /**
   * §24: the custom-build conversation this one came out of, when the customer
   * took a marketplace recommendation. Only honoured on **creation** — resuming
   * deliberately ignores it, because a customer who comes back to a customisation
   * they have already started is continuing that, not restarting it from an older
   * conversation they have since moved past.
   */
  carriedFromConversationId?: string;
}

/**
 * Resume rather than duplicate.
 *
 * §72 requires a conversation be resumable, and a customer who opens "Request
 * customization" twice on the same product means the same conversation both
 * times — not two half-interviews they then have to choose between.
 */
export async function startOrResume(input: StartInput): Promise<AiConversationDoc> {
  await connectToDatabase();

  const owner = input.userId
    ? { userId: toObjectId(input.userId) }
    : input.anonymousKey
      ? { anonymousKey: input.anonymousKey }
      : null;

  /*
   * An owner-less conversation is unreadable by the person who just created it.
   *
   * `assertCanRead` tests organisation, then `anonymousKey`, then `userId`, and
   * throws when all three are absent — so a document written without any of them
   * can never be read again by anybody but staff, and its author gets
   * "No such conversation." on their first message.
   *
   * This used to happen silently on **every render** of the assistant reached by
   * a client-side link: no cookie, `owner === null`, resume skipped, orphan
   * created. Nine of them, all with zero messages, before anyone noticed.
   *
   * `proxy.ts` mints the key so this should now be unreachable. It throws rather
   * than trusting that: the caller has lost the only credential the conversation
   * would have had, and the honest failure is loud and immediate rather than a
   * row nobody can read.
   */
  if (!owner) {
    throw new ValidationError(
      "A conversation needs an owner — no session and no anonymous key was supplied.",
      { owner: ["Missing both userId and anonymousKey."] },
    );
  }

  const existing = await AiConversation.findOne({
    ...owner,
    contextType: input.contextType,
    status: "active",
    ...(input.productId ? { productId: toObjectId(input.productId) } : { productId: null }),
  })
    .sort({ updatedAt: -1 })
    .lean<AiConversationDoc>();

  if (existing) return existing;

  const created = await AiConversation.create({
    contextType: input.contextType,
    ...(input.productId ? { productId: toObjectId(input.productId) } : {}),
    ...(input.productVersionId ? { productVersionId: toObjectId(input.productVersionId) } : {}),
    ...(input.productVersionNumber ? { productVersionNumber: input.productVersionNumber } : {}),
    ...(input.userId ? { userId: toObjectId(input.userId) } : {}),
    ...(input.organizationId ? { organizationId: toObjectId(input.organizationId) } : {}),
    ...(input.anonymousKey ? { anonymousKey: input.anonymousKey } : {}),
    ...(input.carriedFromConversationId
      ? { carriedFromConversationId: toObjectId(input.carriedFromConversationId) }
      : {}),
    // Recorded at creation, so a conversation is always attributable to the
    // wording that shaped it even after the prompts move on.
    promptVersion: PROMPT_VERSION,
    status: "active",
  });

  return created.toObject() as AiConversationDoc;
}

export async function appendMessage(conversationId: string, message: AiMessage): Promise<void> {
  await connectToDatabase();

  await AiConversation.updateOne(
    { _id: toObjectId(conversationId) },
    {
      $push: { messages: message },
      // Running total, so the admin screen does not have to sum an array of
      // hundreds to show one number.
      $inc: { totalCostMicros: message.costMicros ?? 0 },
    },
  );
}

/**
 * Attach an anonymous conversation to the account that just signed in — §17.
 *
 * Called from the same place the cart merge is. Everything the visitor said
 * survives; only the ownership changes.
 */
export async function claimForUser(
  anonymousKey: string,
  userId: string,
  organizationId: string,
): Promise<number> {
  await connectToDatabase();

  const result = await AiConversation.updateMany(
    { anonymousKey, status: "active", userId: { $exists: false } },
    {
      $set: { userId: toObjectId(userId), organizationId: toObjectId(organizationId) },
      // Cleared, or the next visitor sharing this browser inherits them.
      $unset: { anonymousKey: "" },
    },
  );

  return result.modifiedCount;
}

/** "Start over" — the §17 escape hatch. Abandoned, never deleted (§19). */
export async function abandon(conversationId: string, viewer: Viewer): Promise<void> {
  const conversation = await getConversation(conversationId, viewer);
  if (conversation.status === "submitted") {
    throw new ForbiddenError("A submitted conversation can't be discarded.");
  }

  await AiConversation.updateOne({ _id: conversation._id }, { $set: { status: "abandoned" } });
}

/**
 * §24 — what we showed and what they chose.
 *
 * Slugs come in; ids go into `recommendedProductIds`, because a slug can change
 * (ticket 09 keeps redirects for exactly that reason) and this record is read
 * months later to ask "which custom requests could the catalogue already have
 * served?"
 */
export async function recordRecommendation(
  conversationId: string,
  choice: "existing_product" | "custom_build",
  shownSlugs: readonly string[],
): Promise<void> {
  await connectToDatabase();

  const { Product } = await import("@/lib/db/models/catalog");
  const shown = shownSlugs.length
    ? await Product.find({ slug: { $in: [...shownSlugs] } })
        .select({ _id: 1 })
        .lean<{ _id: unknown }[]>()
    : [];

  await AiConversation.updateOne(
    { _id: toObjectId(conversationId) },
    {
      $set: {
        recommendationChoice: choice,
        recommendedProductIds: shown.map((product) => product._id),
      },
    },
  );
}
