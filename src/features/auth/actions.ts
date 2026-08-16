"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { fail, formDataToObject, ok, parseInput, withAction } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import { getAuth } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { Organization } from "@/lib/db/models/identity";
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

  const issued = result.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair));

  const existing = requestHeaders.get("cookie");
  const merged = [existing, ...issued].filter(Boolean).join("; ");

  const authenticatedHeaders = new Headers(requestHeaders);
  if (merged) authenticatedHeaders.set("cookie", merged);

  return { authenticatedHeaders };
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
  const displayName = input.name ?? `${input.userName}'s workspace`;

  const created = await getAuth().api.createOrganization({
    body: { name: displayName, slug: await uniqueSlug(displayName) },
    headers: input.headers,
  });

  if (input.isPersonal && created?.id) {
    // `isPersonal` is declared `input: false` on the Better Auth side so it
    // cannot be asserted by a client; only this path decides it. Written after
    // creation rather than through the plugin because the plugin's hook has no
    // way to know whether an organization name was supplied.
    await connectToDatabase();
    await Organization.updateOne({ _id: created.id }, { $set: { isPersonal: true } });
  }
}

/**
 * Slugs are unique (§76) and public — they appear in URLs — so they are derived
 * from the name but never *are* the name.
 */
async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace";

  await connectToDatabase();

  // A short random suffix on collision rather than an incrementing counter:
  // `acme-2` tells the world Acme was taken, and a counter needs a read-then-
  // write that races under concurrent signups.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    const taken = await Organization.exists({ slug: candidate });
    if (!taken) return candidate;
  }
  return `${base}-${randomSuffix()}${randomSuffix()}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
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

    try {
      await getAuth().api.signInEmail({
        body: {
          email: input.email,
          password: input.password,
          rememberMe: input.rememberMe,
        },
        headers: await headers(),
      });
    } catch (error) {
      if (isAPIError(error)) {
        // Every credential failure looks identical from out here — see the
        // enumeration note at the top of this file.
        return fail(GENERIC_CREDENTIALS_ERROR, { code: "UNAUTHENTICATED" });
      }
      throw error;
    }

    return ok(undefined as never);
  });

  if (!result.ok) return result;
  redirect(safeRedirectPath(formDataString(formData, "next"), "/dashboard"));
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

    try {
      await getAuth().api.acceptInvitation({
        body: { invitationId: input.invitationId },
        headers: await headers(),
      });
    } catch (error) {
      if (isAPIError(error)) {
        return fail("That invitation is no longer valid.", { code: "VALIDATION" });
      }
      throw error;
    }

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
