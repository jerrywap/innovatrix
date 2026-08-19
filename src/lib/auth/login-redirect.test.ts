import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { clearSessionCookies, hasSessionCookie, sessionCookieNames } from "./session-cookies";

/**
 * Nothing may redirect to a bare `/login`.
 *
 * ## The loop
 *
 * `proxy.ts` guards the protected areas by checking a session cookie is
 * **present**, and never reads the database — that is what keeps it at zero
 * queries per request. The DAL checks whether the session is **valid**.
 *
 * For a cookie that exists and has expired the two disagree, and they disagree
 * forever:
 *
 * ```
 * GET /dashboard  → proxy sees a cookie, passes it through
 *                 → guard finds no session, redirect("/login")
 * GET /login      → proxy sees a cookie, redirect("/dashboard")
 * ```
 *
 * A super-admin whose session had expired hit exactly this and got
 * `ERR_TOO_MANY_REDIRECTS`.
 *
 * ## Why a source rule rather than a unit test
 *
 * Because the bug was **a second copy of the redirect**. The DAL was fixed and
 * the loop survived, because `app/dashboard/layout.tsx` had its own
 * `redirect("/login")` — reasonably, since it needs the session for the chrome
 * anyway. `loginDestination()` cannot help a caller that does not call it, so
 * the rule has to be about the shape of the code.
 */

/** `redirect("/login")`, or with a query string, but not via a variable. */
const BARE_LOGIN_REDIRECT = /redirect\(\s*["'`]\/login/;

const EXEMPT = [
  // Defines the choice.
  join("src", "lib", "auth", "dal.ts"),
  // Clears the cookie first, so `/login` is safe by the time it redirects.
  join("src", "app", "api", "auth", "stale-session", "route.ts"),
  join("src", "features", "auth", "actions.ts"),
  // This file quotes the pattern to describe it.
  join("src", "lib", "auth", "login-redirect.test.ts"),
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

describe("no route sends a possibly-stale session to a bare /login", () => {
  it("routes every login redirect through loginDestination()", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles("src")) {
      const rel = relative(process.cwd(), file);
      if (EXEMPT.some((exempt) => rel.endsWith(exempt))) continue;
      if (BARE_LOGIN_REDIRECT.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }

    expect(
      offenders,
      "use `redirect(await loginDestination())` — a bare /login loops for an expired cookie",
    ).toEqual([]);
  });
});

describe("session cookie names", () => {
  it("covers both the plain and the __Secure- spelling", () => {
    // `useSecureCookies` picks one from `APP_URL`. Clearing only the spelling we
    // expect leaves the other in place, and the loop with it.
    const names = sessionCookieNames();
    expect(names).toContain("cosetup.session_token");
    expect(names).toContain("__Secure-cosetup.session_token");
  });

  it("recognises a session cookie by shape, either spelling", () => {
    expect(hasSessionCookie({ getAll: () => [{ name: "cosetup.session_token" }] })).toBe(true);
    expect(
      hasSessionCookie({ getAll: () => [{ name: "__Secure-cosetup.session_data" }] }),
    ).toBe(true);
  });

  it("does not mistake our other cookies for a session", () => {
    // A cart or a conversation key must not make the DAL think there is a stale
    // session to clear — that would send a signed-out visitor through the
    // clearing route on every visit.
    for (const name of ["cosetup_cart", "cosetup_conv", "cosetup_currency"]) {
      expect(hasSessionCookie({ getAll: () => [{ name }] }), name).toBe(false);
    }
  });

  it("recognises the pre-rebrand prefix, so a stale one gets cleared", () => {
    // Every visitor signed in before the CoSetup rename is carrying an
    // `innovatrix.*` cookie Better Auth will never accept again. If this returns
    // false the proxy stops seeing it, nothing ever clears it, and the visitor
    // keeps a dead credential in their jar for good.
    expect(hasSessionCookie({ getAll: () => [{ name: "innovatrix.session_token" }] })).toBe(
      true,
    );
    expect(sessionCookieNames()).toContain("innovatrix.session_token");
  });

  it("deletes what is present and reports how many", () => {
    // One current, one legacy — both must go.
    const present = new Set(["cosetup.session_token", "innovatrix.session_data"]);
    const cleared = clearSessionCookies({
      has: (name) => present.has(name),
      delete: (name) => present.delete(name),
    });

    expect(cleared).toBe(2);
    expect(present.size).toBe(0);
  });

  it("is happy when there is nothing to clear", () => {
    expect(clearSessionCookies({ has: () => false, delete: () => undefined })).toBe(0);
  });
});
