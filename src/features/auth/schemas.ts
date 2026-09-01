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

/*
 * `safeRedirectPath` and `optionalRedirectPath` used to live here and now live in
 * `@/lib/return-path`.
 *
 * They had to move: `proxy.ts` runs on the Edge runtime and cannot import a
 * feature module, so it hand-rolled the same three open-redirect checks, and
 * `services/marketplace/query.ts` hand-rolled them a third time. The new module
 * imports nothing but a type, which is what lets all four callers share one rule.
 */
