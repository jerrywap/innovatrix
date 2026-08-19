/**
 * The session cookie prefix, on its own.
 *
 * Deliberately **not** in `session-cookies.ts`: that module is `server-only`,
 * and `proxy.ts` needs this string to ask Better Auth whether a session cookie
 * is present. Same reasoning as `services/ai/conversation-cookie.ts` — a name
 * two runtimes must agree on lives in a module both can reach.
 *
 * Three files depend on this agreeing: `auth.ts` sets Better Auth's
 * `cookiePrefix` from it, `proxy.ts` reads cookies back with it, and
 * `session-cookies.ts` deletes them by it. The CoSetup rebrand is what proved
 * the literal could not be repeated: two of the three were updated and the
 * third — the proxy — was not, which would have left the proxy blind to every
 * valid session and bounced every signed-in visitor to `/login`.
 */
export const COOKIE_PREFIX = "cosetup";
