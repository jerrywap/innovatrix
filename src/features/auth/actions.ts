"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { isAPIError } from "better-auth/api";
import { fail, formDataToObject, ok, parseInput, withAction } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import { serverEnv } from "@/config/env";
import { getAuth } from "@/lib/auth/auth";
import { getSession, requireUser } from "@/lib/auth/dal";
import { clearSessionCookies } from "@/lib/auth/session-cookies";
import { adoptGuestStateFor, withIssuedCookies } from "./adopt-guest-state";
import { connectToDatabase, mongoose } from "@/lib/db/client";
import { log } from "@/lib/logger";
import { Organization } from "@/lib/db/models/identity";
import {
  personalOrganizationName,
  repairMissingOrganization,
  uniqueSlug,
} from "@/lib/auth/personal-organization";
import {
  acceptInviteSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  safeRedirectPath,
} from "./schemas";

/**
 * Authentication server actions — §75, §88.
 *
 * These wrap Better Auth's server API rather than calling its HTTP endpoints
 * from the browser, so that:
 *
 * - forms work without JavaScript,
 * - every failure comes back in the one `ActionResult` shape the rest of the
 *   app already renders,
 * - and error text is ours, not the library's.
 *
 * ## Enumeration
 *
 * §88 requires messages that don't disclose whether an address is registered.
 * Two rules follow, and both are easy to undo by accident:
 *
 * 1. **Sign-in never distinguishes** "no such user" from "wrong password".
 *    Better Auth returns different codes for these; `signInAction` collapses
 *    them.
 * 2. **Password reset always reports success**, whether or not the address
 *    exists. The only signal is whether an email arrives.
 *
 * Registration is the unavoidable exception — an account either can or cannot
 * be created at that address — so it fails with a message that reads as
 * advice ("try signing in") rather than confirmation.
 */

const GENERIC_CREDENTIALS_ERROR = "That email and password combination isn't right.";

/* ────────────────────────────────────────────── register */

export async function registerAction(
  _prev: ActionResult<never> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  const result = await withAction<never>(async () => {
    const input = parseInput(registerSchema, formDataToObject(formData));
    const requestHeaders = await headers();

    let signUp: Awaited<ReturnType<typeof signUpWithHeaders>>;
    try {
      signUp = await signUpWithHeaders(input, requestHeaders);
    } catch (error) {
      if (isAPIError(error)) {
        // The one place we cannot avoid confirming an address exists.
        // Note the code is USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL, not the
        // shorter constant that also exists in the admin plugin — matching
        // only the short one silently sent every duplicate signup down the
        // "something went wrong" path.
        if (
          error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" ||
          error.body?.code === "USER_ALREADY_EXISTS"
        ) {
          return fail("An account already exists for that email. Try signing in instead.", {
            code: "CONFLICT",
            fieldErrors: { email: ["An account already exists for that email."] },
          });
        }
        return fail(error.body?.message ?? "We couldn't create that account.", {
          code: "VALIDATION",
        });
      }
      throw error;
    }

    // §76: every customer resource belongs to an organization, so a solo
    // customer gets one immediately. Done here rather than in a database hook
    // because it needs the signed-in session to establish ownership.
    await createInitialOrganization({
      name: input.organizationName,
      userName: input.name,
      isPersonal: !input.organizationName,
      headers: signUp.authenticatedHeaders,
    });

    // After the organization, not before: the claim stamps `organizationId` on
    // whatever it adopts, and there is nothing to stamp until this point.
    await adoptGuestStateFor(signUp.authenticatedHeaders);

    return ok(undefined as never);
  });

  if (!result.ok) return result;
  // Outside withAction: redirect() throws, and throwing inside would be caught
  // as control flow and rethrown anyway — clearer to do it here.
  redirect(safeRedirectPath(formDataString(formData, "next"), "/dashboard"));
}

/**
 * Sign up, and return headers that are actually authenticated as the new user.
 *
 * The subtlety this exists for: **the incoming request headers have no session
 * cookie**, and signing up does not retroactively change them. `nextCookies()`
 * writes the cookie to the *response*, which the browser will send on the
 * *next* request — but the very next thing we do happens inside this same one.
 * Passing `await headers()` to `createOrganization` therefore calls it
 * unauthenticated, and it fails.
 *
 * So we ask for the response headers, lift the `Set-Cookie` values Better Auth
 * just issued, and hand them back as a `Cookie` header — precisely what a
 * browser would have done, one round trip earlier.
 */
async function signUpWithHeaders(
  input: { name: string; email: string; password: string },
  requestHeaders: Headers,
): Promise<{ authenticatedHeaders: Headers }> {
  const result = await getAuth().api.signUpEmail({
    body: { name: input.name, email: input.email, password: input.password },
    headers: requestHeaders,
    returnHeaders: true,
  });

  // The lift itself now lives in `adopt-guest-state.ts`, because sign-in needs
  // it for the same reason. The docblock above is still the explanation.
  return { authenticatedHeaders: withIssuedCookies(requestHeaders, result.headers) };
}

/**
 * The organization a new customer lands in.
 *
 * `isPersonal` lets the dashboard hide organization chrome from someone who
 * has no colleagues — the record still exists, so nothing downstream needs a
 * "user without an org" branch.
 */
async function createInitialOrganization(input: {
  name: string | undefined;
  userName: string;
  isPersonal: boolean;
  headers: Headers;
}): Promise<void> {
  // Shared with the social path, so a Google signup and an email signup with no
  // company name produce the same thing rather than two near-identical strings.
  const displayName = input.name ?? personalOrganizationName(input.userName);

  const created = await getAuth().api.createOrganization({
    body: { name: displayName, slug: await organizationSlug(displayName) },
    headers: input.headers,
  });

  if (!created?.id) return;

  if (input.isPersonal) {
    // `isPersonal` is declared `input: false` on the Better Auth side so it
    // cannot be asserted by a client; only this path decides it. Written after
    // creation rather than through the plugin because the plugin's hook has no
    // way to know whether an organization name was supplied.
    await connectToDatabase();
    await Organization.updateOne({ _id: created.id }, { $set: { isPersonal: true } });
  }

  await adoptActiveOrganization(String(created.id), input.headers);
}

/**
 * Point the session's **cached** copy at an organization the database already
 * knows about.
 *
 * ## The bug this exists for
 *
 * `session.cookieCache` is enabled, so `getSession()` usually answers from a
 * signed `session_data` cookie rather than the database. Better Auth mints that
 * cookie when the session is created and refreshes it when *it* sets a cookie —
 * and `createOrganization` and `acceptInvitation` both change the active
 * organization by calling `internalAdapter.updateSession` directly, which
 * touches the row and never the cookie.
 *
 * At registration those two facts compose into a broken signup. The order is
 * forced: `signUpEmail` creates the session, so the cookie is minted with
 * `activeOrganizationId: null` because the organization does not exist yet; the
 * organization is created a moment later and the row is corrected. For the next
 * `cookieCache.maxAge` seconds every read still comes off the cookie, so
 * `requireOrg()` sees no organization and `/dashboard` renders "your account
 * isn't set up yet" — about an account that is, in the database, entirely
 * correct. It heals itself after a minute, which is exactly long enough for a
 * new customer to give up.
 *
 * `setActiveOrganization` is the one path that does both halves: same row
 * update, and then `setSessionCookie`, which re-issues the cache. It re-checks
 * the membership and re-reads the organization, so it costs a few queries — paid
 * once, at signup or at invitation, and never on a normal request.
 *
 * ## Failure is not fatal here
 *
 * The database is already right by the time this runs. If it throws, the caller
 * has still created an account or joined an organization, and the worst case is
 * the stale minute we were trying to avoid — so this must not turn a successful
 * registration into an error message. Logged rather than swallowed silently,
 * because a *persistent* failure looks identical to the original bug.
 */
async function adoptActiveOrganization(
  organizationId: string,
  requestHeaders: Headers,
): Promise<void> {
  try {
    await getAuth().api.setActiveOrganization({
      body: { organizationId },
      headers: requestHeaders,
    });
  } catch (error) {
    log.exception("Could not refresh the session's active organization", error, {
      code: "auth.active_org_refresh_failed",
      organizationId,
    });
  }
}

/**
 * Slugs are unique (§76) and public — they appear in URLs — so they are derived
 * from the name but never *are* the name.
 */
async function organizationSlug(name: string): Promise<string> {
  await connectToDatabase();
  // The rules — and the random-suffix-on-collision decision behind them — live
  // in `personal-organization.ts`, because the Google path creates its
  // organization through the raw driver and cannot call this. Two copies of a
  // uniqueness rule is one copy too many; only the "is it taken" question
  // differs, so only that is passed in.
  return uniqueSlug(name, async (candidate) =>
    Boolean(await Organization.exists({ slug: candidate })),
  );
}

function formDataString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/* ────────────────────────────────────────────── sign in */

export async function signInAction(
  _prev: ActionResult<never> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  const result = await withAction<never>(async () => {
    const input = parseInput(loginSchema, formDataToObject(formData));
    const requestHeaders = await headers();

    let issued: Headers;
    try {
      const signIn = await getAuth().api.signInEmail({
        body: {
          email: input.email,
          password: input.password,
          rememberMe: input.rememberMe,
        },
        headers: requestHeaders,
        // For the cookie lift below, not for the body.
        returnHeaders: true,
      });
      issued = signIn.headers;
    } catch (error) {
      if (isAPIError(error)) {
        // Every credential failure looks identical from out here — see the
        // enumeration note at the top of this file.
        return fail(GENERIC_CREDENTIALS_ERROR, { code: "UNAUTHENTICATED" });
      }
      throw error;
    }

    /*
     * §12 and §17: fold in whatever they built before signing in.
     *
     * The lifted headers, not `await headers()` — the session cookie is on the
     * *response* and the browser will not send it until the next request, so
     * reading the session off this one finds nothing and silently does nothing.
     * That is the same trap `signUpWithHeaders` documents.
     */
    await adoptGuestStateFor(withIssuedCookies(requestHeaders, issued));

    return ok(undefined as never);
  });

  if (!result.ok) return result;
  redirect(safeRedirectPath(formDataString(formData, "next"), "/dashboard"));
}

/* ────────────────────────────────────────────── sign in with google */

/**
 * OAuth, as a server action rather than a client `signIn.social()` call.
 *
 * ## Why not the client helper
 *
 * `client.ts` states the convention: authentication goes through server actions
 * so the forms work without JavaScript and every failure arrives in one
 * `ActionResult` shape. Google is the one flow that *must* leave the site, but
 * that is a `redirect()` — which a server action does natively. Calling
 * `signIn.social()` from a click handler would make this the only sign-in path
 * that silently does nothing with JS disabled.
 *
 * ## `next` travels to Google and back
 *
 * `callbackURL` is where Better Auth returns the browser after the round trip.
 * It is attacker-influenced — it started as `?next=` on our own URL — so it goes
 * through `safeRedirectPath` before it is handed over, exactly as the password
 * path does. Better Auth will honour whatever string we give it.
 *
 * ## The flag is checked here too
 *
 * The pages hide the button when Google is off, but a server action is a public
 * POST endpoint: hiding the control is not the check (AGENTS.md).
 */
export async function signInWithGoogleAction(
  _prev: ActionResult<never> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  let destination: string | undefined;

  const result = await withAction<never>(async () => {
    if (!serverEnv().AUTH_GOOGLE_ENABLED) {
      return fail("Google sign-in isn't available.", { code: "VALIDATION" });
    }

    const next = safeRedirectPath(formDataString(formData, "next"), "/dashboard");

    /*
     * `callbackURL` goes to `/api/auth/after-sign-in`, not straight to `next`.
     *
     * That handler folds in the cart and the conversation the visitor built
     * before signing in, then forwards them to `next`. It has to be a Route
     * Handler and it has to be reached this way: OAuth completes inside Better
     * Auth with no action of ours in the path, and its callback issues a real
     * 302, so the handler actually runs. See its docblock for why a Server
     * Action must never redirect there.
     *
     * `next` has already been through `safeRedirectPath`; the handler checks it
     * again on the way out, because by then it has been round-tripped through
     * Google.
     */
    const response = await getAuth().api.signInSocial({
      body: {
        provider: "google",
        callbackURL: `/api/auth/after-sign-in?next=${encodeURIComponent(next)}`,
        errorCallbackURL: "/login?error=google",
      },
      headers: await headers(),
    });

    // `signInSocial` returns either a URL to send the browser to, or — for a
    // flow that completed server-side — no URL at all. Only the first is
    // meaningful here.
    if (!response?.url) {
      return fail("Google sign-in couldn't be started.", { code: "PROVIDER_UNAVAILABLE" });
    }

    destination = response.url;
    return ok(undefined as never);
  });

  if (!result.ok) return result;

  // Outside `withAction`, like every other redirect in this file: Next
  // implements it by throwing, and the wrapper must not swallow navigation.
  //
  // `typedRoutes` cannot type an off-site URL, and this one is deliberately
  // off-site — it is Google's consent screen. Same cast, and the same reason, as
  // the hand-off to a payment provider in `features/checkout/actions.ts`.
  redirect(destination! as Route);
}

/* ────────────────────────────────────────────── sign out */

export async function signOutAction(): Promise<never> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}

/* ────────────────────────────────────────────── password reset */

export async function forgotPasswordAction(
  _prev: ActionResult<{ sent: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ sent: true }>> {
  return withAction(async () => {
    const input = parseInput(forgotPasswordSchema, formDataToObject(formData));

    try {
      await getAuth().api.requestPasswordReset({
        body: { email: input.email, redirectTo: "/reset-password" },
        headers: await headers(),
      });
    } catch (error) {
      // Swallowed on purpose: a failure here that reached the user would be an
      // oracle for "does this address exist". Logged, not surfaced.
      if (!isAPIError(error)) throw error;
      console.error("[auth] password reset request failed", error.body?.code);
    }

    // Always the same answer.
    return ok({ sent: true as const });
  });
}

export async function resetPasswordAction(
  _prev: ActionResult<never> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  const result = await withAction<never>(async () => {
    const input = parseInput(resetPasswordSchema, formDataToObject(formData));

    try {
      await getAuth().api.resetPassword({
        body: { newPassword: input.password, token: input.token },
        headers: await headers(),
      });
    } catch (error) {
      if (isAPIError(error)) {
        // Single-use and time-limited: a token that has been spent looks
        // exactly like one that never existed.
        return fail("That reset link has expired or already been used. Request a new one.", {
          code: "VALIDATION",
        });
      }
      throw error;
    }

    return ok(undefined as never);
  });

  if (!result.ok) return result;

  /*
   * Clear any session cookie before sending them to `/login`.
   *
   * Two reasons, and the second is the one that bites. Changing a password
   * should end the old session — and a cookie the server no longer accepts sent
   * to `/login` is bounced back to `/dashboard` by the proxy, which guards on
   * presence rather than validity. That is an infinite redirect. A Server
   * Action is one of the two places allowed to delete a cookie, so it happens
   * here rather than being discovered a request later.
   */
  clearSessionCookies(await cookies());
  redirect("/login?reset=1");
}

/* ────────────────────────────────────────────── verification */

export async function resendVerificationAction(): Promise<ActionResult<{ sent: true }>> {
  return withAction(async () => {
    const session = await getSession();
    if (!session) return fail("Please sign in first.", { code: "UNAUTHENTICATED" });
    if (session.user.emailVerified) return ok({ sent: true as const });

    await getAuth().api.sendVerificationEmail({
      body: { email: session.user.email, callbackURL: "/dashboard" },
      headers: await headers(),
    });

    return ok({ sent: true as const });
  });
}

/* ────────────────────────────────────────────── invitations */

export async function acceptInviteAction(
  _prev: ActionResult<never> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  const result = await withAction<never>(async () => {
    const input = parseInput(acceptInviteSchema, formDataToObject(formData));

    const requestHeaders = await headers();
    let accepted: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["acceptInvitation"]>>;

    try {
      accepted = await getAuth().api.acceptInvitation({
        body: { invitationId: input.invitationId },
        headers: requestHeaders,
      });
    } catch (error) {
      if (isAPIError(error)) {
        return fail("That invitation is no longer valid.", { code: "VALIDATION" });
      }
      throw error;
    }

    // Accepting makes the new organization active — in the row only. Same
    // stale-cache problem as registration, and the same repair; see
    // `adoptActiveOrganization`. Milder here, because the invitee already had a
    // personal organization, so for a minute the dashboard shows the *previous*
    // workspace rather than an apology.
    if (accepted?.member?.organizationId) {
      await adoptActiveOrganization(String(accepted.member.organizationId), requestHeaders);
    }

    // An invitee may well have been browsing anonymously first. The request
    // already carries their session, so no cookie lift is needed here.
    await adoptGuestStateFor(requestHeaders);

    return ok(undefined as never);
  });

  if (!result.ok) return result;
  redirect("/dashboard");
}

/* ────────────────────────────────────────────── account setup repair */

/**
 * Give a signed-in customer the organization their signup never created.
 *
 * ## Why this exists as an action and not as a repair on render
 *
 * §76's organization was created in one place, `registerAction`, and Google
 * never reached it — so every Google signup produced a user with no membership
 * and a dashboard reading "your account isn't set up yet". The hook in `auth.ts`
 * fixes that at session creation, which heals anyone affected the next time they
 * sign in. It cannot heal somebody **holding a session right now**: their session
 * row was written with `activeOrganizationId: null` and nothing rewrites it, so
 * they stay stuck for up to `AUTH_SESSION_DAYS`.
 *
 * Repairing it where the problem is *noticed* — in the dashboard layout — would
 * mean a GET that creates an organization, and Next prefetches links on hover
 * and in the viewport. A POST cannot be triggered that way, which is why this is
 * a button on that screen rather than something the layout does quietly.
 *
 * `adoptActiveOrganization` afterwards for the reason its own docblock gives:
 * the row is only half the job while `session.cookieCache` is on, and a Server
 * Action is one of the two places allowed to re-issue the cookie.
 */
export async function completeAccountSetupAction(): Promise<ActionResult<never>> {
  // The DAL first, like every action here, and outside `withAction` so its
  // redirect stays navigation rather than becoming a caught error. A signed-out
  // POST to this belongs at `/login`, not at a message on a screen it cannot
  // see.
  const user = await requireUser();

  const result = await withAction<never>(async () => {
    const requestHeaders = await headers();

    await connectToDatabase();
    const db = mongoose.connection.db;
    if (!db) return fail("We couldn't finish setting up your account.", { code: "INTERNAL" });

    const organizationId = await repairMissingOrganization(
      db,
      new mongoose.Types.ObjectId(user.id),
    );

    if (!organizationId) {
      // Staff, or a user row that has gone. Neither is something the person
      // reading this screen can do anything about.
      return fail(
        "This account can't be set up automatically. Get in touch and we'll sort it out.",
        { code: "VALIDATION" },
      );
    }

    await adoptActiveOrganization(organizationId, requestHeaders);
    return ok(undefined as never);
  });

  if (!result.ok) return result;
  redirect("/dashboard");
}

/* ────────────────────────────────────────────── org switcher */

export async function setActiveOrganizationAction(
  organizationId: string,
): Promise<ActionResult<void>> {
  return withAction(async () => {
    // Better Auth checks membership itself before switching, so a forged id
    // here is refused rather than silently granting scope.
    await getAuth().api.setActiveOrganization({
      body: { organizationId },
      headers: await headers(),
    });
    return ok(undefined);
  });
}
