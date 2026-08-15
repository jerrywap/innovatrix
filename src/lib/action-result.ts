import { z } from "zod";
import { DomainError, GENERIC_ERROR_MESSAGE, ValidationError, isDomainError } from "./errors";

/**
 * The single shape every server action returns.
 *
 * Actions never throw across the RSC boundary: a thrown error in production
 * reaches the client as a redacted digest with no field information, which
 * makes form UX impossible. They return a discriminated union instead.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?: DomainError["code"];
      fieldErrors?: Record<string, string[]>;
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  error: string,
  options: { code?: DomainError["code"]; fieldErrors?: Record<string, string[]> } = {},
): ActionResult<never> {
  return { ok: false, error, ...options };
}

/**
 * Wrap an action body so domain errors become typed failures and everything
 * else becomes a logged, redacted failure.
 *
 * Note this deliberately does NOT catch `redirect()` or `notFound()` — Next.js
 * implements those by throwing, and swallowing them would break navigation.
 */
export async function withAction<T>(
  fn: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (isNextControlFlow(error)) throw error;

    if (error instanceof ValidationError) {
      return fail(error.message, { code: error.code, fieldErrors: error.fieldErrors });
    }
    if (isDomainError(error)) {
      if (error.code === "INTERNAL" || error.code === "PROVIDER_UNAVAILABLE") {
        logUnexpected(error);
      }
      return fail(error.message, { code: error.code });
    }

    logUnexpected(error);
    return fail(GENERIC_ERROR_MESSAGE, { code: "INTERNAL" });
  }
}

/**
 * Next.js signals redirect/notFound by throwing a tagged error. Re-throw those
 * untouched or navigation silently stops working.
 */
function isNextControlFlow(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(
      (error as { digest: string }).digest,
    )
  );
}

function logUnexpected(error: unknown): void {
  // Replaced by structured logging + Sentry in ticket 27.
  console.error("[action]", error);
}

/**
 * Parse untrusted input at the action boundary.
 * Throws ValidationError with per-field messages, which `withAction` turns into
 * a `fieldErrors` map the form can render inline.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      "Please check the highlighted fields.",
      flattenIssues(result.error),
    );
  }
  return result.data;
}

/** FormData → plain object, before Zod. Repeated keys collapse into arrays. */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }
  return out;
}

function flattenIssues(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length ? issue.path.join(".") : "_form";
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return fieldErrors;
}
