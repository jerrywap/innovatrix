import "server-only";
import { REQUEST_ID_HEADER } from "@/config/observability";
import { redact } from "@/lib/redact";

export { REQUEST_ID_HEADER };

/**
 * Structured logging — §95, ticket 27.
 *
 * ## Why not pino
 *
 * pino is the right answer for a Node service and the wrong shape for this one.
 * Next.js runs code in three places — the Node server, the Edge proxy and the
 * browser — and pino is a Node library with a transport thread. The parts of it
 * that matter here are: JSON lines, a level, a request id, and never printing a
 * secret. That is this file, and it works in all three.
 *
 * When the logs go somewhere that ingests them, this is the seam: `emit()` is
 * one function.
 *
 * ## Redaction reuses the audit log's rule
 *
 * `redactAuditPayload` already strips anything whose *key* looks like a secret,
 * depth-capped, and it is already tested. Two different redaction rules in one
 * codebase means one of them is the weaker one and nobody knows which.
 *
 * ## Request id
 *
 * Minted in `proxy.ts` and read from the request headers. It is what turns
 * "somebody saw an error" into a line you can find — the digest shown on the
 * error page is the same value.
 */

export type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** `LOG_LEVEL` is read directly rather than through the env schema. */
function threshold(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  if (configured && configured in LEVELS) return LEVELS[configured];
  return process.env.NODE_ENV === "production" ? LEVELS.info : LEVELS.debug;
}

export interface LogFields {
  /** Correlates every line from one request. See `REQUEST_ID_HEADER`. */
  requestId?: string;
  /** A stable machine-readable code — `payment.stuck`, `job.dead_letter`. */
  code?: string;
  [key: string]: unknown;
}

function emit(level: Level, message: string, fields: LogFields = {}): void {
  if (LEVELS[level] < threshold()) return;

  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...(redact(fields) as LogFields),
  };

  /*
   * `console` rather than a writable stream.
   *
   * Every platform that runs this — Vercel, a container, `next dev` — collects
   * stdout and stderr, and none of them collect a stream we opened. Errors go
   * to stderr because that is where a process supervisor looks for them.
   */
  const rendered =
    process.env.NODE_ENV === "development"
      ? `${level.toUpperCase().padEnd(5)} ${message}${detail(fields)}`
      : JSON.stringify(line);

  if (level === "error") console.error(rendered);
  else if (level === "warn") console.warn(rendered);
  else console.log(rendered);
}

/** One line in development is readable; JSON is not. Same fields either way. */
function detail(fields: LogFields): string {
  const entries = Object.entries(redact(fields) as Record<string, unknown>);
  if (entries.length === 0) return "";
  return (
    " " +
    entries
      .map(
        ([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`,
      )
      .join(" ")
  );
}

export const log = {
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),

  /**
   * An error, with its message and stack flattened into fields.
   *
   * Passing an `Error` straight into `JSON.stringify` produces `{}` — its
   * properties are non-enumerable — so an unstructured logger silently records
   * nothing for the one field anybody wanted.
   */
  exception: (message: string, error: unknown, fields: LogFields = {}) => {
    emit("error", message, {
      ...fields,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      ...(error instanceof Error && error.name !== "Error" ? { kind: error.name } : {}),
    });
  },
};

/**
 * The request id for the current request, if the proxy set one.
 *
 * Returns `undefined` rather than throwing outside a request scope — a job
 * handler and a script both log, and neither has one.
 */
export async function currentRequestId(): Promise<string | undefined> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  } catch {
    return undefined;
  }
}
