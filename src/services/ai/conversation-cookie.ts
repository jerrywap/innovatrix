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
