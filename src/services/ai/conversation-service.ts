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
import { log } from "@/lib/logger";
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

/**
 * Who is asking on an assistant page — and the safety net for §17's transfer.
 *
 * ## Read the cookie whether or not there is a session
 *
 * Both assistant pages used to read the anonymous key **only when signed out**,
 * which is the bug in one line: after signing in there was a session, so the key
 * was never read, so nothing connected the person to the interview they had just
 * spent five minutes on.
 *
 * ## It must run before `startOrResume`, and that is not a style preference
 *
 * `startOrResume` looks up `{ userId }` alone. An unclaimed row still carries
 * `anonymousKey` and no `userId`, so it is not found and a brand-new empty
 * conversation is written — the interview appears to have vanished. Claiming
 * *afterwards*, from a client effect, was the original intent and cannot work:
 * by the time an effect runs the empty row exists, and the customer is looking
 * at it.
 *
 * ## Why here as well as at sign-in
 *
 * `adoptGuestState` already runs on every sign-in path, which is what the cart
 * needs. This is the net for the cases that never pass through one: a session
 * created in another tab an hour ago, and — the common one — `/login`'s "Create
 * an account" link, which drops `?next=` and lands the visitor on `/dashboard`.
 * The cookie lives 30 days, so they are recovered whenever they come back.
 *
 * Idempotent: `claimForUser` unsets `anonymousKey`, so every later call matches
 * nothing. That is also why the cookie is not cleared here — a Server Component
 * cannot, and one indexed no-op query is the whole cost of leaving it.
 */
export async function assistantViewer(
  session: { user: { id: string }; activeOrganizationId: string | null } | null,
): Promise<Viewer> {
  const anonymousKey = await readAnonymousKey();

  if (!session?.user.id) return anonymousKey ? { anonymousKey } : {};

  const organizationId = session.activeOrganizationId ?? undefined;

  if (anonymousKey) {
    try {
      const claimed = await claimForUser(anonymousKey, session.user.id, organizationId);
      if (claimed > 0) {
        log.info("Claimed an anonymous conversation on arrival", {
          code: "ai.conversation.claimed",
          count: claimed,
        });
      }
    } catch (error) {
      // Never fail the page over this. The worst case is the empty conversation
      // they would have had before this function existed.
      log.exception("Could not claim an anonymous conversation", error, {
        code: "ai.conversation.claim_failed",
      });
    }
  }

  return { userId: session.user.id, ...(organizationId ? { organizationId } : {}) };
}

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

/**
 * Union this turn's reported coverage into the conversation.
 *
 * `$addToSet`, so it accumulates and never shrinks — a model that lists seven ids
 * this turn and six the next has not un-answered anything, and a progress
 * indicator that goes backwards is worse than none. Filtering to ids this build
 * knows happens at the call site, which has the context type.
 *
 * No-op on an empty list rather than an update writing nothing: `timestamps: true`
 * would otherwise bump `updatedAt` on every turn that reported nothing, and
 * `startOrResume` resumes on `updatedAt` order.
 */
export async function recordCoverage(conversationId: string, topics: string[]): Promise<void> {
  if (topics.length === 0) return;

  await connectToDatabase();
  await AiConversation.updateOne(
    { _id: toObjectId(conversationId) },
    { $addToSet: { coveredTopics: { $each: topics } } },
  );
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
  /**
   * Optional, deliberately.
   *
   * A session whose `activeOrganizationId` is null — staff, or a customer
   * between organisations — would otherwise be unable to claim at all, and the
   * interview would stay orphaned for the one person most likely to notice.
   * Without it the row gets a `userId` and no `organizationId`, which
   * `assertCanRead` accepts on its `userId` branch; `submitRequirementsAction`
   * supplies the organisation later, from `requireOrg()`.
   */
  organizationId?: string,
): Promise<number> {
  await connectToDatabase();

  const result = await AiConversation.updateMany(
    { anonymousKey, status: "active", userId: { $exists: false } },
    {
      $set: {
        userId: toObjectId(userId),
        ...(organizationId ? { organizationId: toObjectId(organizationId) } : {}),
      },
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
