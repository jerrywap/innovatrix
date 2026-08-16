import "server-only";
import OpenAI from "openai";
import { serverEnv } from "@/config/env";
import { DomainError } from "@/lib/errors";

/**
 * The gateway client — ticket 16.
 *
 * OpenRouter is OpenAI-compatible, so this is the OpenAI SDK pointed at a
 * different `baseURL`. Not `@anthropic-ai/sdk`, and not raw `fetch`: one key
 * and one bill across vendors, per-model cost on the response, and a `models`
 * array the gateway uses to fail over when a provider is down — which is
 * §104's "keep working when one AI provider misbehaves", bought rather than
 * built.
 *
 * What it costs us is vendor-specific conveniences. Anthropic extended
 * thinking, prompt caching and `parse()` do not pass through uniformly, so
 * nothing here may depend on them. The common denominator is chat completions,
 * streaming, tool calling and JSON-schema response format — and even the last
 * one varies by model, which is why `models.ts` reads capability rather than
 * assuming it.
 */

declare global {
  var __innovatrixOpenRouter: OpenAI | undefined;
}

/**
 * The gateway is the problem, so the caller degrades (§104).
 *
 * `PROVIDER_UNAVAILABLE` rather than `INTERNAL` because these are not our bug
 * and the customer's answers are not lost — the manual form is still there.
 */
export class AiUnavailableError extends DomainError {
  constructor(message = "The assistant is unavailable right now.", cause?: unknown) {
    super("PROVIDER_UNAVAILABLE", message, { httpStatus: 503, ...(cause ? { cause } : {}) });
  }
}

/**
 * No key. A configuration state, not a failure, and the one the acceptance
 * criteria test by unsetting `OPENROUTER_API_KEY`.
 */
export class AiNotConfiguredError extends DomainError {
  constructor(message = "The assistant is not configured.") {
    super("PROVIDER_UNAVAILABLE", message, { httpStatus: 503 });
  }
}

export function aiConfigured(): boolean {
  return Boolean(serverEnv().OPENROUTER_API_KEY);
}

/**
 * Ask OpenRouter to price the request.
 *
 * `usage: { include: true }` is **OpenRouter's**, not OpenAI's, so it is absent
 * from the SDK's types and has to be merged in with a cast. Without it the
 * response still carries token counts but reports `cost: 0`, which is how a
 * spend column ends up reading $0.00 beside nine thousand real tokens.
 *
 * Isolated here, and named, so the one place we deviate from the OpenAI surface
 * is obvious rather than scattered as inline casts.
 */
export function withCostAccounting<T extends object>(body: T): T {
  return { ...body, usage: { include: true } } as T;
}

export function openRouter(): OpenAI {
  if (globalThis.__innovatrixOpenRouter) return globalThis.__innovatrixOpenRouter;

  const env = serverEnv();
  if (!env.OPENROUTER_API_KEY) throw new AiNotConfiguredError();

  const client = new OpenAI({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: env.OPENROUTER_BASE_URL,
    defaultHeaders: {
      // OpenRouter attribution. Optional to them, useful to us: it is how spend
      // on their dashboard is attributable to this app rather than a mystery.
      "HTTP-Referer": env.OPENROUTER_SITE_URL ?? "",
      "X-Title": env.OPENROUTER_APP_NAME,
    },
    /*
     * A conversation turn that takes longer than this has already lost the
     * customer. The SDK's default is 10 minutes, which is a batch-job timeout,
     * not an interactive one.
     */
    timeout: 60_000,
    /*
     * Retries are the SDK's, and deliberately few. It only retries what is
     * safely retryable (429, 5xx, connection errors); retrying a completion
     * that half-streamed would duplicate tokens the caller already persisted.
     */
    maxRetries: 2,
  });

  globalThis.__innovatrixOpenRouter = client;
  return client;
}

/**
 * Map a gateway failure onto something a caller can act on.
 *
 * Everything upstream collapses to one question: can the customer keep going?
 * A 401 means our key is wrong and no retry helps; a 429 or 502 means try
 * later. Both degrade to the manual form, and neither should surface a
 * provider's wording to a customer.
 */
export function asAiError(error: unknown): AiUnavailableError | AiNotConfiguredError {
  if (error instanceof AiNotConfiguredError || error instanceof AiUnavailableError) {
    return error;
  }

  const status = (error as { status?: number } | null)?.status;

  if (status === 401 || status === 403) {
    // Deliberately not "invalid API key" — that is an operator's problem, and
    // telling a customer implies they could fix it.
    return new AiUnavailableError("The assistant is unavailable right now.", error);
  }

  if (status === 402) {
    return new AiUnavailableError("The assistant is unavailable right now.", error);
  }

  if (status === 429) {
    return new AiUnavailableError(
      "The assistant is busy at the moment. Your answers are saved.",
      error,
    );
  }

  return new AiUnavailableError(
    "The assistant had a problem. Everything you've told us so far is saved.",
    error,
  );
}
