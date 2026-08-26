"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { formDataToObject } from "@/lib/action-result";
import { requireOrg, requireUser } from "@/lib/auth/dal";
import { ForbiddenError } from "@/lib/errors";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { Organization } from "@/lib/db/models/identity";
import { billingSchema } from "@/validators/checkout";
import { BILLING_ROLES } from "./roles";
import { getAuth } from "@/lib/auth/auth";
import { serverEnv } from "@/config/env";
import { emit } from "@/lib/events";
import { LIMITS, consume } from "@/lib/rate-limit";
import { passwordSchema } from "@/features/auth/schemas";
import { canDisconnect, signInMethods } from "./security-view";

/**
 * The account actions — everything the page used to say "isn't here yet" about.
 *
 * ## Every one goes through Better Auth's server API
 *
 * Not through the collections, and not through `authClient`. `lib/auth/client.ts`
 * states the convention and is imported nowhere: authentication happens in server
 * actions, so the forms work with JavaScript off and every failure arrives in one
 * `ActionResult` shape. These actions extend that to *managing* an account, which
 * is the same argument — a password field that silently does nothing without
 * hydration is worse than a page that says the feature is missing.
 *
 * ## Every one is guarded, and every one is rate limited
 *
 * `requireUser()` first, always: a server action is a public POST endpoint, and
 * `action-guards.test.ts` walks this file to prove it. Then
 * `LIMITS.accountSecurity`, keyed on the user id, because each of these sends the
 * account holder an email — the property `passwordReset` is limited for.
 *
 * ## The security alert is emitted, not sent
 *
 * A change goes on the event bus and the notification pipeline decides who hears
 * about it and how. That gets the in-app row and the email from one emit, keeps
 * the wording in `catalog.ts` beside every other notice, and means these actions
 * contain no email code at all.
 *
 * Emitted **after** the change has succeeded and outside the `withAction` result,
 * never before: an alert about a password change that then failed is worse than a
 * late one (§92).
 */

/* ────────────────────────────────────────────── profile */

/**
 * Display name only.
 *
 * Not the email: `/update-user` refuses it outright with
 * `EMAIL_CAN_NOT_BE_UPDATED`, and changing an address properly needs
 * `user.changeEmail.enabled`, a verification round trip to the *new* address and
 * a template — deferred, and the screen says so rather than showing a disabled
 * box that reads as an oversight.
 *
 * Not the locale either, and that is the more interesting omission: `user.locale`
 * is stored, defaulted and read by **nothing**. `lib/dates.ts` pins `en-GB` on
 * purpose so server and client cannot disagree, and `money.ts` takes its locale
 * from the currency. A picker here would be a control that changes nothing, which
 * is the exact species of stub this screen is replacing.
 */
const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A name is needed — it's what we call you in emails.")
    .max(120, "That's longer than we can store."),
});

export async function saveProfileAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    await requireUser();
    const input = parseInput(profileSchema, formDataToObject(formData));

    await getAuth().api.updateUser({ body: { name: input.name }, headers: await headers() });

    revalidatePath("/dashboard/account");
    // The name is in the account menu in every authenticated shell.
    revalidatePath("/", "layout");
    return ok({ saved: true as const });
  });
}

/* ────────────────────────────────────────────── password */

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Your current password is needed."),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
    // A checkbox, so absent means off. Defaulted on in the form's markup.
    revokeOtherSessions: z
      .union([z.literal("on"), z.literal("")])
      .optional()
      .transform((value) => value === "on"),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Those two passwords don't match.",
    path: ["confirmPassword"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "That's the password you already have.",
    path: ["newPassword"],
  });

export async function changePasswordAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ changed: true }>> {
  const user = await requireUser();

  const result = await withAction<{ changed: true }>(async () => {
    const input = parseInput(changePasswordSchema, formDataToObject(formData));
    const limited = await overLimit(user.id);
    if (limited) return limited;

    try {
      await getAuth().api.changePassword({
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: input.revokeOtherSessions,
        },
        headers: await headers(),
      });
    } catch (error) {
      return authFailure(error, {
        field: "currentPassword",
        message: "That isn't your current password.",
      });
    }

    revalidatePath("/dashboard/account/security");
    return ok({ changed: true as const });
  });

  if (result.ok) await announce("PasswordChanged", { userId: user.id });
  return result;
}

/**
 * For an account that signed up with Google and has no password yet.
 *
 * Better Auth's `/set-password` is `serverOnly`, so it is unreachable from the
 * browser by design — which makes a server action the only way to offer it at
 * all, rather than a stylistic preference.
 */
const setPasswordSchema = z
  .object({ newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Those two passwords don't match.",
    path: ["confirmPassword"],
  });

export async function setPasswordAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ set: true }>> {
  const user = await requireUser();

  const result = await withAction<{ set: true }>(async () => {
    const input = parseInput(setPasswordSchema, formDataToObject(formData));
    const limited = await overLimit(user.id);
    if (limited) return limited;

    // Checked server-side rather than trusted from the form: the button is only
    // rendered when there is no password, and a hidden button is not a check.
    const methods = await signInMethods();
    if (methods.hasPassword) {
      return fail("This account already has a password. Change it instead.", {
        code: "VALIDATION",
      });
    }

    try {
      await getAuth().api.setPassword({
        body: { newPassword: input.newPassword },
        headers: await headers(),
      });
    } catch (error) {
      return authFailure(error, { message: "That password couldn't be set." });
    }

    revalidatePath("/dashboard/account/security");
    return ok({ set: true as const });
  });

  if (result.ok) await announce("PasswordSet", { userId: user.id });
  return result;
}

/* ────────────────────────────────────────────── sessions */

export async function revokeSessionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ revoked: true }>> {
  return withAction(async () => {
    await requireUser();
    const input = parseInput(
      z.object({ token: z.string().trim().min(1) }),
      formDataToObject(formData),
    );

    /*
     * The token comes from a form, so it is a claim. It is not checked against
     * this user's sessions here, because it does not need to be: Better Auth
     * scopes `revokeSession` to the session the request arrived on, so a token
     * belonging to somebody else is simply not found. The guard above is what
     * makes that scoping meaningful.
     */
    try {
      await getAuth().api.revokeSession({
        body: { token: input.token },
        headers: await headers(),
      });
    } catch (error) {
      return authFailure(error, { message: "That session couldn't be signed out." });
    }

    revalidatePath("/dashboard/account/security");
    return ok({ revoked: true as const });
  });
}

export async function revokeOtherSessionsAction(): Promise<ActionResult<{ revoked: true }>> {
  return withAction(async () => {
    const user = await requireUser();
    const limited = await overLimit(user.id);
    if (limited) return limited;

    try {
      await getAuth().api.revokeOtherSessions({ headers: await headers() });
    } catch (error) {
      return authFailure(error, { message: "Those sessions couldn't be signed out." });
    }

    revalidatePath("/dashboard/account/security");
    return ok({ revoked: true as const });
  });
}

/* ────────────────────────────────────────────── connected accounts */

/*
 * Neither of these takes a parameter: there is no form data, and the session
 * comes from the cookie. `useActionState` still passes the previous state, which
 * they ignore — the same shape as `markAllReadAction`.
 */

/**
 * Connect Google to an account that already exists.
 *
 * `accountLinking` is already enabled with `google` trusted, so signing in with
 * a matching verified address links automatically. What was missing is the
 * deliberate version: somebody who signed up with a password and wants the Google
 * button to work for them too.
 *
 * A form post and a redirect, exactly like `signInWithGoogleAction` — same
 * reason, which that action's comment gives in full: Google is the one flow that
 * must leave the site, and a `redirect()` is something a server action does
 * natively while a click handler is something JavaScript has to be present for.
 */
export async function connectGoogleAction(): Promise<ActionResult<never>> {
  let destination: string | undefined;

  const result = await withAction<never>(async () => {
    const user = await requireUser();
    const limited = await overLimit(user.id);
    if (limited) return limited;

    // The pages hide the button when Google is off; a server action is a public
    // endpoint, so hiding the control is not the check.
    if (!serverEnv().AUTH_GOOGLE_ENABLED) {
      return fail("Google isn't available.", { code: "VALIDATION" });
    }

    const response = await getAuth().api.linkSocialAccount({
      body: { provider: "google", callbackURL: "/dashboard/account/security" },
      headers: await headers(),
    });

    if (!response?.url) {
      return fail("Google couldn't be connected.", { code: "PROVIDER_UNAVAILABLE" });
    }

    destination = response.url;
    return ok(undefined as never);
  });

  if (!result.ok) return result;

  // Outside `withAction`: Next implements redirect by throwing and the wrapper
  // must not swallow navigation. `typedRoutes` cannot type Google's consent
  // screen, hence the cast — the same one `signInWithGoogleAction` makes.
  redirect(destination! as Route);
}

export async function disconnectGoogleAction(): Promise<ActionResult<{ disconnected: true }>> {
  const user = await requireUser();

  const result = await withAction<{ disconnected: true }>(async () => {
    const limited = await overLimit(user.id);
    if (limited) return limited;

    /*
     * The lock-out guard, and the reason it is here rather than only in the UI.
     * Disconnecting the last sign-in method leaves an account nobody can reach —
     * not even by password reset, if the address was the provider's. `canDisconnect`
     * is pure and unit-tested for exactly this.
     */
    const verdict = canDisconnect(await signInMethods(), "google");
    if (!verdict.allowed) {
      return fail(verdict.reason, { code: "VALIDATION" });
    }

    try {
      await getAuth().api.unlinkAccount({
        body: { providerId: "google" },
        headers: await headers(),
      });
    } catch (error) {
      return authFailure(error, { message: "Google couldn't be disconnected." });
    }

    revalidatePath("/dashboard/account/security");
    return ok({ disconnected: true as const });
  });

  if (result.ok) {
    await announce("SocialAccountUnlinked", { userId: user.id, provider: "google" });
  }
  return result;
}

/* ────────────────────────────────────────────── shared */

/**
 * `consume` and a written message, rather than `enforce` and a throw.
 *
 * The house pattern — see `LIMITS.aiExtract` in `features/requirements/actions.ts`.
 * `enforce` throws `RateLimitError`, which `withAction` would flatten into the
 * generic "Too many attempts. Please wait a moment."; a caller that knows what
 * was being attempted can say something more useful, and say it without the
 * reader wondering whether their password actually changed.
 *
 * Returns the failure rather than throwing it, so the call site reads as the
 * early return it is.
 */
async function overLimit(userId: string): Promise<ActionResult<never> | null> {
  const budget = await consume(LIMITS.accountSecurity, `account:${userId}`);
  if (budget.allowed) return null;

  return fail(
    "That's several security changes in a row. Wait a few minutes and try again — " +
      "nothing you have already changed is affected.",
    { code: "RATE_LIMITED" },
  );
}

/**
 * Tell the account holder, and never let that failure undo the change.
 *
 * The password *is* changed by the time this runs. If the notification pipeline
 * is down, the right outcome is a changed password and a logged failure, not an
 * action that reports failure for something that succeeded — which would send the
 * reader back to try again with a password that is no longer current.
 *
 * `emit` already swallows and logs per handler; this catches the bus itself.
 */
async function announce<K extends "PasswordChanged" | "PasswordSet" | "SocialAccountUnlinked">(
  event: K,
  payload: Parameters<typeof emit<K>>[1],
): Promise<void> {
  try {
    await emit(event, payload);
  } catch (error) {
    console.error(
      `[account] ${event} succeeded but could not be announced:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * A Better Auth failure, as an `ActionResult`.
 *
 * `isAPIError` distinguishes "the provider said no" from a bug. Anything that is
 * not an API error is rethrown so `withAction` logs it with a reference, rather
 * than being flattened into a message that hides a real fault.
 */
function authFailure(
  error: unknown,
  options: { message: string; field?: string },
): ActionResult<never> {
  if (!isAPIError(error)) throw error;

  /*
   * Freshness gets its own message, because the generic one sends the reader in
   * the wrong direction entirely.
   *
   * Better Auth guards some endpoints with `sensitiveSessionMiddleware`, which
   * compares `session.createdAt` against `freshAge` — one day by default — and
   * `updateAge` never resets `createdAt`. So the answer is genuinely "sign in
   * again", and there is nothing wrong with what they typed. Telling somebody
   * their current password is wrong when their session is simply old is how an
   * account gets reset for no reason.
   */
  if (isStale(error)) {
    return fail(
      "For your security we need you to sign in again before changing this. Sign out, " +
        "sign back in, and it will go through.",
      { code: "UNAUTHENTICATED" },
    );
  }

  return fail(options.message, {
    code: "VALIDATION",
    ...(options.field ? { fieldErrors: { [options.field]: [options.message] } } : {}),
  });
}

/** Better Auth's `SESSION_NOT_FRESH`, whichever endpoint raised it. */
function isStale(error: unknown): boolean {
  const body = (error as { body?: { code?: string } }).body;
  return body?.code === "SESSION_NOT_FRESH";
}

/* ────────────────────────────────────────────── billing details */

/**
 * The organisation's billing details, picked off the checkout schema.
 *
 * `.pick()` rather than a second schema, because these are the same fields with
 * the same rules and the rules have already been argued about: the country is
 * validated because it decides the tax rate, and everything else is permissive
 * because `validators/checkout.ts` records that rejecting an address on a
 * postcode format is how a sale is lost to a format nobody had seen.
 *
 * `organizationName` is deliberately not editable here. It is the organisation's
 * identity, `slug` is derived from it, and renaming a company is not a billing
 * correction — which is what this form is for.
 */
const accountBillingSchema = billingSchema.pick({
  email: true,
  line1: true,
  line2: true,
  city: true,
  region: true,
  postcode: true,
  country: true,
  taxId: true,
});

export async function saveBillingDetailsAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const context = await requireOrg();

    // The tab is drawn only for these roles and the page refuses with a 403, but
    // an action is a public POST — so the role is checked here too rather than
    // trusted from the fact that a form was rendered.
    if (!(BILLING_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenError("Only an owner, admin or billing contact can change these.");
    }

    const input = parseInput(accountBillingSchema, formDataToObject(formData));

    await connectToDatabase();
    await Organization.updateOne(
      { _id: toObjectId(context.organizationId) },
      {
        $set: {
          billingEmail: input.email,
          billingAddress: {
            line1: input.line1,
            line2: input.line2,
            city: input.city,
            region: input.region,
            postcode: input.postcode,
            country: input.country,
          },
          // Cleared rather than left behind when emptied: a stale VAT number on
          // an invoice is worse than none.
          taxId: input.taxId ?? null,
        },
      },
    );

    revalidatePath("/dashboard/account/billing");
    return ok({ saved: true as const });
  });
}
