/**
 * Domain errors.
 *
 * Every error here carries a message that is safe to show a customer. Anything
 * a customer must not read (query fragments, provider payloads, stack traces)
 * goes in `context`, which is logged and never serialized to a response.
 */

export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "CONFLICT"
  | "STATE_TRANSITION"
  | "PAYMENT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  /** Never sent to the client. */
  readonly context: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { httpStatus?: number; context?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = options.httpStatus ?? defaultStatus(code);
    this.context = options.context ?? {};
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "STATE_TRANSITION":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "PROVIDER_UNAVAILABLE":
      return 503;
    case "PAYMENT":
    case "INTERNAL":
      return 500;
  }
}

export class ValidationError extends DomainError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    message = "Please check the highlighted fields.",
    fieldErrors: Record<string, string[]> = {},
  ) {
    super("VALIDATION", message);
    this.fieldErrors = fieldErrors;
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, context: Record<string, unknown> = {}) {
    super("NOT_FOUND", `We couldn’t find that ${resource}.`, { context });
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = "Please sign in to continue.") {
    super("UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(
    message = "You don’t have access to this.",
    context: Record<string, unknown> = {},
  ) {
    super("FORBIDDEN", message, { context });
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("CONFLICT", message, { context });
  }
}

/** An attempt to move a record between states the state machine forbids (§91). */
export class StateTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super("STATE_TRANSITION", `A ${entity} cannot move from ${from} to ${to}.`, {
      context: { entity, from, to },
    });
  }
}

export class PaymentError extends DomainError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super("PAYMENT", message, { context });
  }
}

export class RateLimitError extends DomainError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = "Too many attempts. Please wait a moment.") {
    super("RATE_LIMITED", message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** An upstream we don't control is down — AI provider, payment provider, storage. */
export class ProviderUnavailableError extends DomainError {
  constructor(provider: string, cause?: unknown) {
    super(
      "PROVIDER_UNAVAILABLE",
      "That service is temporarily unavailable. Please try again shortly.",
      {
        context: { provider },
        cause,
      },
    );
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/**
 * The only message an unknown error is ever allowed to produce. Anything that
 * isn't a DomainError may contain a driver string, a connection URI or a
 * provider response — none of which a customer should see.
 */
export const GENERIC_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";

export function toSafeMessage(error: unknown): string {
  return isDomainError(error) ? error.message : GENERIC_ERROR_MESSAGE;
}
