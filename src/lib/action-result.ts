import { z } from "zod";
import { DomainError, GENERIC_ERROR_MESSAGE, ValidationError, isDomainError } from "./errors";
import { log } from "./logger";

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
      /**
       * Set only for an *unmodelled* failure, and echoed into the log line.
       *
       * The generic message alone is untraceable: a customer reports "something
       * went wrong", and there is nothing tying that report to any of the
       * afternoon's log entries. This is the thread between the two.
       */
      reference?: string;
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  error: string,
  options: {
    code?: DomainError["code"];
    fieldErrors?: Record<string, string[]>;
    reference?: string;
  } = {},
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

    const reference = failureReference();
    logUnexpected(error, reference);
    return fail(`${GENERIC_ERROR_MESSAGE} (ref ${reference})`, {
      code: "INTERNAL",
      reference,
    });
  }
}

/** Short, quotable, and not a database id. */
function failureReference(): string {
  return `E-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/**
 * Name the *class* of unexpected failure in the log.
 *
 * A Mongoose `ValidationError` is not a random crash — it means our data and
 * our schema disagree, which is always our bug and is usually one field. It
 * arrives here rather than as a `DomainError` because Mongoose has its own
 * error hierarchy, and it reads identically to every other unhandled throw once
 * it reaches the customer.
 *
 * Detected by shape rather than by importing Mongoose, so this module stays
 * free of a database dependency it otherwise has no need for.
 *
 * This exists because a mistyped enum in a seed script made a thousand products
 * unbuyable, and the only symptom anywhere was "Something went wrong on our
 * side" on the last click of the checkout funnel.
 */
function classifyUnexpected(error: unknown): string {
  if (!(error instanceof Error)) return "action.unhandled";

  if (error.name === "ValidationError" && "errors" in error) return "action.data_integrity";
  if (error.name === "CastError") return "action.data_integrity";
  if (error.name === "MongoServerError" || error.name === "MongoBulkWriteError") {
    return "action.database";
  }
  if (error.name === "TimeoutError" || error.name === "AbortError") return "action.timeout";

  return "action.unhandled";
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

/**
 * An error a server action did not expect.
 *
 * The client gets a redacted digest with no detail — that is the whole reason
 * `ActionResult` exists — so this is the only place the actual cause is
 * recorded. Structured, with the stack flattened into a field: passing an
 * `Error` to `JSON.stringify` produces `{}`, because its properties are
 * non-enumerable, so an unstructured logger would record nothing for the one
 * field anybody wanted.
 */
function logUnexpected(error: unknown, reference?: string): void {
  log.exception("Unhandled error in a server action", error, {
    code: classifyUnexpected(error),
    ...(reference ? { reference } : {}),
  });
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
