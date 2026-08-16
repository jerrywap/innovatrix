import type { Route } from "next";
import { z } from "zod";

/**
 * Auth input schemas.
 *
 * Kept out of `actions.ts` so client components can import them for the same
 * validation without pulling a `server-only` module into the browser bundle.
 */

/**
 * 12 characters, no composition rules.
 *
 * NIST SP 800-63B is explicit that mandatory character-class rules push people
 * toward predictable substitutions (`Password1!`) while length does the actual
 * work. The maximum exists only so a megabyte-long input can't be used to burn
 * CPU in the hash.
 */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters — length matters more than symbols.")
  .max(128, "That password is too long.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(120),
  email: emailSchema,
  password: passwordSchema,
  /**
   * Optional. A solo customer gets a personal organization named after them;
   * anyone buying on behalf of a company names it here (§76).
   */
  organizationName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  next: z.string().optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
  rememberMe: z
    .union([z.literal("on"), z.literal("true"), z.boolean()])
    .optional()
    .transform((v) => v === "on" || v === "true" || v === true),
  next: z.string().optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Those passwords don't match.",
    path: ["confirmPassword"],
  });

export const acceptInviteSchema = z.object({ invitationId: z.string().min(1) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Where to send someone after signing in.
 *
 * Only same-origin *paths* are honoured. `//evil.com` and `https://evil.com`
 * are both valid values of a `next` query parameter and both are open
 * redirects — the second slash check is the one that catches the protocol-
 * relative form.
 *
 * ## The cast
 *
 * `typedRoutes` makes `redirect()` and `<Link href>` take a `Route`, and this
 * is the one place in the codebase where that guarantee cannot hold: the value
 * arrives from a query string at runtime, so no compile-time check can know
 * whether `/dashboard/orders/ORD-2026-0148` exists.
 *
 * This function is therefore the boundary. Everything it returns has been
 * proven to be a same-origin path, and the cast is confined here rather than
 * scattered across each caller — where the next person would copy it without
 * the validation.
 */
export function safeRedirectPath(
  next: string | undefined,
  fallback: Route = "/dashboard",
): Route {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.startsWith("/\\")) return fallback;
  return next as Route;
}

/**
 * The same check, for the case where "no redirect" is a real answer.
 *
 * A page rendering a form needs to know whether to *include* a hidden `next`
 * field at all. Passing `""` as the fallback to `safeRedirectPath` was the
 * previous way of asking that, and `""` is not a route — it only compiled
 * before `typedRoutes` was turned on.
 */
export function optionalRedirectPath(next: string | undefined): Route | undefined {
  if (!next) return undefined;
  const resolved = safeRedirectPath(next, "/dashboard");
  // safeRedirectPath falls back when the input is unsafe; treat that as "none"
  // rather than silently redirecting somewhere the caller didn't ask for.
  return resolved === "/dashboard" && next !== "/dashboard" ? undefined : resolved;
}
