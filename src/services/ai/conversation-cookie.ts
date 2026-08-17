/**
 * The anonymous-conversation cookie name, on its own.
 *
 * Deliberately **not** in `conversation-service.ts`: that module is
 * `server-only` and reaches the database, and `proxy.ts` runs in the proxy
 * runtime where neither is available. Importing the service from the proxy
 * fails at build; duplicating the string in two files fails later and quieter,
 * when one of them is renamed.
 */
export const CONVERSATION_COOKIE = "innovatrix_conv";

/** Thirty days — long enough to come back to an interview after a weekend. */
export const CONVERSATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * The cookie's shape, in one place.
 *
 * Two runtimes write this cookie — `proxy.ts` and, for a Route Handler,
 * `ensureAnonymousKey()` — and they had drifted: the proxy derived `secure`
 * from `request.nextUrl.protocol`, the service from `APP_URL`. Behind a TLS
 * terminator those disagree, and the disagreement runs the wrong way: the
 * internal hop is plain HTTP, so the proxy would drop `Secure` from a cookie on
 * a site served over HTTPS.
 *
 * Only `secure` is left to the caller, because only the caller can know it —
 * `@/config/env` is `server-only` and cannot be imported from the proxy
 * runtime, which is the same reason the name lives in this module rather than
 * in the service.
 */
export function conversationCookie(value: string, secure: boolean) {
  return {
    name: CONVERSATION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: CONVERSATION_COOKIE_MAX_AGE,
  };
}
