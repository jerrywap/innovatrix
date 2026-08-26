import { describe, expect, it } from "vitest";
import { canDisconnect, describeDevice } from "./security-view";

/**
 * The two pure pieces of the security tab.
 *
 * `canDisconnect` is here because its failure mode is the only unrecoverable one
 * in this feature: a wrong `true` locks somebody out of their own account, and no
 * amount of care in the UI helps because the button would simply work. Everything
 * else on that screen fails visibly and recoverably.
 *
 * `describeDevice` is here for the case nobody writes by hand — the string it
 * cannot read. Getting "Chrome on macOS" right is easy; not printing
 * "undefined on undefined" is the part that needed pinning.
 */

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

describe("canDisconnect", () => {
  it("allows it when a password is still there to sign in with", () => {
    expect(canDisconnect({ hasPassword: true, providers: ["google"] }, "google")).toEqual({
      allowed: true,
    });
  });

  it("allows it when another provider remains", () => {
    expect(
      canDisconnect({ hasPassword: false, providers: ["google", "github"] }, "google"),
    ).toEqual({ allowed: true });
  });

  it("refuses to remove the only way in", () => {
    // The whole reason this function exists. No password and one provider means
    // disconnecting leaves an account nobody can reach — not even by password
    // reset, if the address was the provider's.
    const verdict = canDisconnect({ hasPassword: false, providers: ["google"] }, "google");
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toContain("Set a password first");
  });

  it("refuses a provider that was never connected", () => {
    // A server action takes the provider from a form, so "google" can arrive for
    // an account that has no Google row. Refusing beats asking Better Auth to
    // unlink something absent and interpreting whatever it says.
    expect(canDisconnect({ hasPassword: true, providers: [] }, "google").allowed).toBe(false);
  });
});

describe("describeDevice", () => {
  it("names the browser and the platform", () => {
    expect(describeDevice(CHROME_MAC)).toBe("Chrome on macOS");
    expect(describeDevice(SAFARI_IPHONE)).toBe("Safari on iPhone");
  });

  it("prefers the most specific browser, because they all claim to be each other", () => {
    // Edge's string contains both "Chrome/" and "Safari/". Testing in the wrong
    // order labels every Edge session "Chrome", which is exactly the kind of
    // wrong that makes somebody ignore a session they should not.
    expect(describeDevice(EDGE_WINDOWS)).toBe("Edge on Windows");
  });

  it("says so when there is no user agent at all", () => {
    expect(describeDevice(undefined)).toBe("Unknown device");
    expect(describeDevice("")).toBe("Unknown device");
  });

  it("falls back to the string itself rather than inventing a name", () => {
    expect(describeDevice("some-internal-agent/2")).toBe("some-internal-agent/2");
  });

  it("truncates a long string it cannot read, rather than breaking the row", () => {
    const long = "x".repeat(120);
    const described = describeDevice(long);
    expect(described).toHaveLength(41);
    expect(described.endsWith("…")).toBe(true);
  });

  it("recognises a non-browser client, so an API session is identifiable", () => {
    expect(describeDevice("curl/8.7.1")).toBe("curl");
  });
});
