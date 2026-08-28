import "server-only";
import { revalidatePath } from "next/cache";
import { getAuth } from "@/lib/auth/auth";
import { log } from "@/lib/logger";
import { claimForUser, readAnonymousKey } from "@/services/ai/conversation-service";
import * as cartService from "@/services/cart/cart-service";
import { clearGuestCookie, readOwnerKey } from "@/services/cart/owner";
import { cartCurrency } from "@/features/cart/load";

/**
 * Everything a visitor built before signing in — §12 (cart), §17 (conversation).
 *
 * ## The bug this exists for
 *
 * Both halves were written and **neither was ever called**. `mergeCartAction`
 * and `claimConversationsAction` each had zero callers anywhere in the tree;
 * `action-guards.test.ts` even documented the cart merge as "runs at sign-in,
 * over both keys", which was simply not true.
 *
 * What that cost: an anonymous visitor could complete an entire requirements
 * interview, be told "Sign in to send this — everything you've written stays
 * exactly as it is", sign in, and land on an empty conversation. The row
 * survived in the database the whole time, still carrying its `anonymousKey`;
 * nothing ever transferred it. The cart lost its contents the same way.
 *
 * ## Why the ids are arguments rather than read from the session
 *
 * Because at the moment this runs there **is no session on the request**.
 * `signInEmail` and `signUpEmail` write the cookie to the *response*, which the
 * browser will send on the *next* request — so `getSession()` here would find
 * nothing and silently no-op, which is exactly the failure mode the whole file
 * exists to prevent. `adoptGuestStateFor` does the cookie lift that
 * `signUpWithHeaders` already does for `createOrganization`, and hands the ids
 * down.
 *
 * ## Where it is called from
 *
 * Every sign-in path, because there is no single page a signed-in customer must
 * land on for a cart to be worth keeping:
 *
 * - `signInAction`, `registerAction`, `acceptInviteAction` — Server Actions, so
 *   they may clear the guest cookies, and their redirects go to **pages**.
 * - `/api/auth/after-sign-in` — the Route Handler Google's `callbackURL` points
 *   at, because OAuth completes inside Better Auth with no action of ours in the
 *   path.
 *
 * A Server Action must **never** redirect to that handler. The client router
 * cannot render a Route Handler — it fetches one as RSC, gets a bodyless
 * redirect, and stops on a blank page. Google is safe because Better Auth's
 * callback issues a real 302 and the whole chain is a document navigation.
 *
 * The assistant pages additionally claim on arrival (`assistantViewer`), which
 * is the net for somebody who signed in an hour ago in another tab — or who
 * took `/login`'s "Create an account" link, which drops `?next=`.
 *
 * ## Failure is never fatal
 *
 * A lost basket is bad; a sign-in that fails because a basket could not be
 * merged is worse. Each half is caught separately so one cannot take the other
 * down with it, and neither can take the sign-in down.
 */
export async function adoptGuestState(input: {
  userId: string;
  organizationId?: string;
}): Promise<void> {
  let touched = false;

  // The conversation first: it is the one with a person waiting to press submit.
  try {
    const anonymousKey = await readAnonymousKey();
    if (anonymousKey) {
      const claimed = await claimForUser(anonymousKey, input.userId, input.organizationId);
      if (claimed > 0) {
        touched = true;
        log.info("Claimed an anonymous conversation at sign-in", {
          code: "ai.conversation.claimed",
          count: claimed,
        });
      }
    }
  } catch (error) {
    log.exception("Could not claim an anonymous conversation at sign-in", error, {
      code: "ai.conversation.claim_failed",
    });
  }

  try {
    const guestOwnerKey = await readOwnerKey(undefined);
    if (guestOwnerKey) {
      const result = await cartService.mergeOnLogin(
        guestOwnerKey,
        input.userId,
        input.organizationId,
        await cartCurrency(),
      );
      // Cleared whether or not anything moved: the key has served its purpose,
      // and leaving it lets the next person on a shared browser inherit it.
      await clearGuestCookie();
      if (result.merged > 0) {
        touched = true;
        log.info("Merged a guest cart at sign-in", {
          code: "cart.merged",
          merged: result.merged,
          dropped: result.dropped.length,
        });
      }
    }
  } catch (error) {
    log.exception("Could not merge a guest cart at sign-in", error, {
      code: "cart.merge_failed",
    });
  }

  // The cart count sits in the header on every page, so the layout is what needs
  // re-rendering — and only when something actually moved.
  if (touched) revalidatePath("/", "layout");
}

/**
 * The same thing, for a caller that has just created a session and therefore
 * cannot read one off the request yet.
 *
 * `headers` must already carry the session cookie — either the request's own
 * (the caller was signed in before it ran) or the merge of the request's and
 * whatever `Set-Cookie` Better Auth just issued.
 */
export async function adoptGuestStateFor(headers: Headers): Promise<void> {
  try {
    const session = await getAuth().api.getSession({ headers });
    if (!session?.user) return;

    await adoptGuestState({
      userId: String(session.user.id),
      organizationId: session.session.activeOrganizationId
        ? String(session.session.activeOrganizationId)
        : undefined,
    });
  } catch (error) {
    log.exception("Could not resolve the new session to adopt guest state", error, {
      code: "auth.adopt_guest_state_failed",
    });
  }
}

/**
 * Merge the cookies Better Auth just issued into a copy of the request's.
 *
 * Precisely what a browser would have sent one round trip later. Extracted from
 * `signUpWithHeaders`, which needed it first and for the same reason.
 */
export function withIssuedCookies(requestHeaders: Headers, issued: Headers): Headers {
  const pairs = issued
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair));

  const merged = [requestHeaders.get("cookie"), ...pairs].filter(Boolean).join("; ");

  const authenticated = new Headers(requestHeaders);
  if (merged) authenticated.set("cookie", merged);
  return authenticated;
}
