import { describe, expect, it } from "vitest";
import {
  clearedReturnCookie,
  isAuthPath,
  loginPath,
  optionalRedirectPath,
  RETURN_COOKIE,
  returnCookieOptions,
  safeRedirectPath,
  storedReturnPath,
} from "./return-path";

/**
 * The return path, which is the only part of "continue where you were" a unit
 * test can reach.
 *
 * The rest of it — the proxy stamping a cookie, seven guards building a URL, six
 * links carrying a parameter — is plumbing whose failure mode is a wrong
 * destination, not a wrong value. What *can* be pinned here is the open-redirect
 * guard and the two refusals the plumbing depends on: an auth path is never a
 * destination, and an unusable stored value is the same as none.
 *
 * The first block moved here from `features/auth/schemas.test.ts` with the
 * function it covers.
 */

describe("safeRedirectPath — open-redirect guard", () => {
  it("keeps a same-origin path", () => {
    expect(safeRedirectPath("/dashboard/orders")).toBe("/dashboard/orders");
    expect(safeRedirectPath("/checkout?step=2")).toBe("/checkout?step=2");
  });

  /**
   * Each of these is a working open redirect against a naive
   * `startsWith("/")` check. The protocol-relative form is the one that gets
   * missed: `//evil.com` is a valid URL that browsers resolve against the
   * current scheme.
   */
  it.each([
    ["absolute https", "https://evil.example/phish"],
    ["absolute http", "http://evil.example"],
    ["protocol-relative", "//evil.example/phish"],
    ["backslash-relative", "/\\evil.example"],
    ["scheme-ish", "javascript:alert(1)"],
    ["bare host", "evil.example"],
  ])("rejects %s", (_label, value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });

  it("falls back when absent or empty", () => {
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
    expect(safeRedirectPath(undefined, "/")).toBe("/");
  });
});

describe("isAuthPath — an auth screen is never somewhere to come back to", () => {
  it("recognises the auth screens, with or without a query", () => {
    for (const path of [
      "/login",
      "/login?expired=1",
      "/register",
      "/forgot-password",
      "/verify-email?token=abc",
    ]) {
      expect(isAuthPath(path)).toBe(true);
    }
  });

  /**
   * Prefix, not equality. `/reset-password/<token>` and `/accept-invite?id=`
   * carry one-shot credentials in the URL; parking one for ten minutes and
   * replaying it later is worse than losing the destination.
   */
  it("covers the one-shot credential paths below them", () => {
    expect(isAuthPath("/reset-password/abc123")).toBe(true);
    expect(isAuthPath("/accept-invite?id=xyz")).toBe(true);
  });

  it("leaves ordinary pages alone", () => {
    // `/loginsomething` shares a prefix and is not an auth screen — the check is
    // on the segment, not on `startsWith`.
    for (const path of ["/", "/sell", "/details/atlas-crm", "/loginsomething"]) {
      expect(isAuthPath(path)).toBe(false);
    }
    expect(isAuthPath(null)).toBe(false);
  });
});

describe("loginPath", () => {
  it("carries a same-origin destination", () => {
    expect(loginPath("/dashboard/selling/apply")).toBe(
      "/login?next=%2Fdashboard%2Fselling%2Fapply",
    );
  });

  it("appends to ?expired=1 rather than replacing it", () => {
    // The stale-cookie hop is where the destination is least recoverable and
    // most wanted — nobody chose to be there.
    expect(loginPath("/cart", "/login?expired=1")).toBe("/login?expired=1&next=%2Fcart");
  });

  it("refuses an auth path, which is what stops /login redirecting to itself", () => {
    expect(loginPath("/login")).toBe("/login");
    expect(loginPath("/register?next=%2Fcart")).toBe("/login");
  });

  it("falls back to a bare /login for anything unusable", () => {
    for (const value of [null, undefined, "", "//evil.example", "https://evil.example"]) {
      expect(loginPath(value)).toBe("/login");
    }
  });
});

describe("storedReturnPath", () => {
  it("re-validates on the way out, not just on the way in", () => {
    // The cookie is httpOnly and we wrote it — but this is the value that
    // becomes a `redirect()`, so it is proven by the code that redirects.
    expect(storedReturnPath("/cart")).toBe("/cart");
    expect(storedReturnPath("//evil.example")).toBeUndefined();
    expect(storedReturnPath("/login")).toBeUndefined();
    expect(storedReturnPath(undefined)).toBeUndefined();
  });
});

describe("the return cookie", () => {
  it("is httpOnly and short-lived", () => {
    const options = returnCookieOptions("/cart", true);
    expect(options.name).toBe(RETURN_COOKIE);
    expect(options.value).toBe("/cart");
    // Nothing in the browser reads it, and a value that becomes a redirect
    // target has no business being writable by a script on the page.
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.maxAge).toBe(600);
  });

  it("clears with the same name and path, or the browser keeps two", () => {
    const cleared = clearedReturnCookie(true);
    expect(cleared.name).toBe(RETURN_COOKIE);
    expect(cleared.path).toBe(returnCookieOptions("/cart", true).path);
    expect(cleared.maxAge).toBe(0);
  });
});

describe("optionalRedirectPath", () => {
  it("says 'none' rather than silently choosing the dashboard", () => {
    expect(optionalRedirectPath(undefined)).toBeUndefined();
    expect(optionalRedirectPath("https://evil.example")).toBeUndefined();
    expect(optionalRedirectPath("/dashboard")).toBe("/dashboard");
    expect(optionalRedirectPath("/cart")).toBe("/cart");
  });
});
