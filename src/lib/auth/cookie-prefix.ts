/**
 * The session cookie prefix, the names built from it, and how to expire one.
 *
 * Deliberately **not** in `session-cookies.ts`: that module is `server-only`,
 * and `proxy.ts` needs this to ask Better Auth whether a session cookie is
 * present — and, since the PPR fix, to clear one. Same reasoning as
 * `services/ai/conversation-cookie.ts` — a name two runtimes must agree on
 * lives in a module both can reach.
 *
 * Four files depend on this agreeing: `auth.ts` sets Better Auth's
 * `cookiePrefix` from it, `proxy.ts` reads cookies back with it *and* expires
 * them, and `session-cookies.ts` expires them too. The CoSetup rebrand is what
 * proved the literal could not be repeated: two of the three were updated and
 * the third — the proxy — was not, which would have left the proxy blind to
 * every valid session and bounced every signed-in visitor to `/login`.
 */
export const COOKIE_PREFIX = "cosetup";

/**
 * Prefixes we no longer set but may still be holding a browser hostage.
 *
 * The CoSetup rebrand moved the prefix, and a rename is exactly the situation
 * this file exists for: every signed-in visitor is carrying an `innovatrix.*`
 * cookie that Better Auth will never accept again. Leave it out and it is
 * invisible to everything below — the proxy stops recognising it, so there is
 * no loop, but nothing ever expires it either, and the visitor keeps a dead
 * credential in their jar indefinitely.
 *
 * Including it means the proxy still sees "a session", the DAL still finds it
 * invalid, and the clear-and-render path removes it on the first request.
 *
 * This list can be emptied once no plausible visitor still holds one —
 * `AUTH_SESSION_DAYS` past the deploy is the honest threshold.
 */
const LEGACY_PREFIXES = ["innovatrix"] as const;

const ALL_PREFIXES = [COOKIE_PREFIX, ...LEGACY_PREFIXES];

/** The suffixes Better Auth appends. Its list to change, so matched by shape too. */
const BASES = ["session_token", "session_data", "dont_remember"] as const;

/**
 * Every cookie Better Auth may have set for a session under our prefixes.
 *
 * Both the plain and `__Secure-` spellings, because `useSecureCookies` decides
 * which is live from `APP_URL` and guessing wrong leaves a dead credential in
 * place. Expiring a cookie that was never set costs nothing.
 */
export function sessionCookieNames(): string[] {
  return ALL_PREFIXES.flatMap((prefix) =>
    BASES.flatMap((base) => [`${prefix}.${base}`, `__Secure-${prefix}.${base}`]),
  );
}

/** Does this name look like one of ours? Shape, not an exact list. */
export function isSessionCookieName(name: string): boolean {
  return new RegExp(`(${ALL_PREFIXES.join("|")})\\.(session_token|session_data)`).test(name);
}

/**
 * The attributes that actually remove `name` from a browser.
 *
 * ## Why this is not `jar.delete(name)`
 *
 * Next's `cookies().delete()` emits `name=; Path=/; Expires=<epoch>` and
 * **nothing else** — in particular, no `Secure`. For an ordinary cookie that is
 * fine. For one whose name begins with `__Secure-` it is inert: the cookie
 * prefix rules require a browser to *reject any `Set-Cookie` for a `__Secure-`
 * name that does not carry the `Secure` attribute*, so Chrome discards the
 * expiry and the cookie survives.
 *
 * That is not theoretical. On an HTTPS deployment `usesSecureCookies()` is
 * true, so the live session cookie **is** `__Secure-cosetup.session_token` —
 * meaning the one route written to break the redirect loop could not break it,
 * and the loop was permanent until the visitor cleared cookies by hand. It
 * looked healthy in local development, where `APP_URL` is http, the cookie is
 * plain-named, and `delete()` works.
 *
 * `curl` does not enforce the prefix rule, which is why a scripted check of
 * this passed while every real browser stayed stuck. Verified against UAT.
 *
 * `secure` is therefore keyed to the **name**, not to the request: a
 * `__Secure-` cookie can only be expired by a `Secure` instruction, and a
 * plain-named one has no such requirement, so it is expired without — which is
 * what lets a pre-rebrand `innovatrix.*` cookie set over http still go.
 */
export function sessionCookieExpiry(name: string): {
  name: string;
  value: string;
  path: string;
  expires: Date;
  maxAge: number;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
} {
  return {
    name,
    value: "",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    // The whole point. See above.
    secure: name.startsWith("__Secure-"),
  };
}
