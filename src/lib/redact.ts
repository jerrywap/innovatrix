/**
 * Strip anything whose *key* suggests a secret.
 *
 * Lifted out of `services/audit` when the logger needed it too. Two different
 * redaction rules in one codebase means one of them is the weaker one and
 * nobody knows which — so there is one, here, with no dependencies, and both
 * the audit log and the logger use it.
 *
 * No `server-only`: it is pure, and the constraint that matters is that it runs
 * everywhere something might log.
 *
 * ## Keys, not values
 *
 * A heuristic on values either misses things (a secret that looks like a word)
 * or redacts legitimate prose (a support message containing "password"). The
 * key is what the caller chose to name the field, and a field called
 * `passwordCipher` holds one whatever is in it.
 */

/** Anything matching this is replaced, however the caller passed it. */
const SECRET_KEY = /password|cipher|secret|token|credential|apikey|api_key|authorization/i;

export const REDACTED = "[redacted]";

/**
 * Depth-capped rather than cycle-detecting.
 *
 * A `WeakSet` would handle cycles exactly and costs an allocation on every call
 * on a path that runs on every log line. The cap is what stops a hostile —
 * or merely self-referencing — object from hanging the process, which is the
 * property that actually matters.
 */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return out as T;
}
