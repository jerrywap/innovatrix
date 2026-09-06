import { describe, expect, it } from "vitest";
import { isPubliclyRoutable, verdictFromHeaders } from "./frameability";

/**
 * Ticket 31. Two pure functions carry the whole of the risk here — the header
 * rules, which decide whether a visitor sees a demo or a fallback, and the
 * address predicate, which is the only thing standing between a vendor-supplied
 * URL and our own network.
 *
 * The probe itself is not tested: it is `fetch`, a redirect loop and a timeout,
 * and a test of it would be a test of `fetch`. `## Live verification` in the
 * ticket covers it against real hosts, which is the evidence a suite cannot give.
 */

const US = "https://cosetup.net";
const THEM = "https://demo.vendor.example";

const verdict = (
  xfo: string | null,
  csp: string | null,
  viewer = US,
  target = THEM,
): "allowed" | "blocked" => verdictFromHeaders(xfo, csp, viewer, target);

describe("verdictFromHeaders — X-Frame-Options", () => {
  it("allows when the header is absent", () => {
    expect(verdict(null, null)).toBe("allowed");
  });

  it("blocks DENY and SAMEORIGIN, in any casing", () => {
    expect(verdict("DENY", null)).toBe("blocked");
    expect(verdict("deny", null)).toBe("blocked");
    expect(verdict("SAMEORIGIN", null)).toBe("blocked");
    expect(verdict("  SameOrigin  ", null)).toBe("blocked");
  });

  /**
   * `SAMEORIGIN` means *their* origin, never ours. The one case where the two
   * could coincide is a product pointing its demo at the site it is listed on,
   * and that is refused by `frame-ancestors 'none'` a line later anyway.
   */
  it("treats SAMEORIGIN as a refusal even when the demo is on our own origin", () => {
    expect(verdict("SAMEORIGIN", null, US, US)).toBe("blocked");
  });

  /**
   * The correction to ticket 31's first draft. Every current browser ignores
   * `ALLOW-FROM`, so a host sending only that frames fine — and this function
   * predicts the browser rather than grading the header. Calling it blocked
   * would manufacture the one error this feature must not make.
   */
  it("ignores ALLOW-FROM, because browsers do", () => {
    expect(verdict("ALLOW-FROM https://cosetup.net", null)).toBe("allowed");
    expect(verdict("ALLOW-FROM https://elsewhere.example", null)).toBe("allowed");
  });

  it("blocks when a repeated header joins into a list containing a refusal", () => {
    // `Headers.get` joins repeated headers with ", ". Browsers treat conflicting
    // values as a refusal.
    expect(verdict("SAMEORIGIN, DENY", null)).toBe("blocked");
    expect(verdict("ALLOW-FROM https://x.example, DENY", null)).toBe("blocked");
  });

  it("ignores a value it does not recognise rather than guessing", () => {
    expect(verdict("ALLOWALL", null)).toBe("allowed");
    expect(verdict("", null)).toBe("allowed");
  });
});

describe("verdictFromHeaders — CSP frame-ancestors", () => {
  it("allows a strict CSP that says nothing about framing", () => {
    // The trap: `frame-ancestors` has no `default-src` fallback, so a policy
    // this strict still places no restriction on being framed.
    expect(verdict(null, "default-src 'none'; script-src 'self'")).toBe("allowed");
  });

  it("blocks 'none'", () => {
    expect(verdict(null, "frame-ancestors 'none'")).toBe("blocked");
    expect(verdict(null, "default-src 'self'; frame-ancestors 'none'; object-src 'none'")).toBe(
      "blocked",
    );
  });

  it("treats a present but empty source list as 'none'", () => {
    expect(verdict(null, "default-src 'self'; frame-ancestors;")).toBe("blocked");
  });

  it("allows when we are named, with or without a scheme", () => {
    expect(verdict(null, "frame-ancestors https://cosetup.net")).toBe("allowed");
    expect(verdict(null, "frame-ancestors cosetup.net")).toBe("allowed");
    expect(verdict(null, "frame-ancestors https://other.example https://cosetup.net")).toBe(
      "allowed",
    );
  });

  it("blocks when the list names somebody else", () => {
    expect(verdict(null, "frame-ancestors https://other.example")).toBe("blocked");
    expect(verdict(null, "frame-ancestors https://notcosetup.net")).toBe("blocked");
  });

  it("honours a wildcard host, and does not let it match the bare apex", () => {
    expect(verdict(null, "frame-ancestors *.cosetup.net", "https://shop.cosetup.net")).toBe(
      "allowed",
    );
    // `*.cosetup.net` matches subdomains only — the apex needs its own entry.
    expect(verdict(null, "frame-ancestors *.cosetup.net", "https://cosetup.net")).toBe(
      "blocked",
    );
  });

  it("honours * and a scheme-source", () => {
    expect(verdict(null, "frame-ancestors *")).toBe("allowed");
    expect(verdict(null, "frame-ancestors https:")).toBe("allowed");
    // We are https; a policy admitting only http does not admit us.
    expect(verdict(null, "frame-ancestors http:")).toBe("blocked");
  });

  it("resolves 'self' against the framed document, not against us", () => {
    // A demo pointed at the site it is listed on — the case that opened the ticket.
    expect(verdict(null, "frame-ancestors 'self'", US, US)).toBe("allowed");
    expect(verdict(null, "frame-ancestors 'self'", US, THEM)).toBe("blocked");
  });

  /**
   * Multiple policies are enforced as an intersection: the frame must satisfy
   * every one of them. They arrive either as repeated headers, which
   * `Headers.get` joins with ", ", or as one comma-separated value.
   */
  it("blocks when any one of several policies blocks", () => {
    expect(verdict(null, "frame-ancestors https://cosetup.net, frame-ancestors 'none'")).toBe(
      "blocked",
    );
    expect(verdict(null, "default-src 'self', frame-ancestors https://cosetup.net")).toBe(
      "allowed",
    );
  });

  it("is case-insensitive about the directive name", () => {
    expect(verdict(null, "Frame-Ancestors 'None'")).toBe("blocked");
  });

  it("tolerates the whitespace real policies are written with", () => {
    expect(verdict(null, "  default-src 'self' ;   frame-ancestors   'none'  ; ")).toBe(
      "blocked",
    );
  });

  it("lets X-Frame-Options block even when the CSP would allow", () => {
    expect(verdict("DENY", "frame-ancestors https://cosetup.net")).toBe("blocked");
  });

  /**
   * Deliberate leniency, documented at `sourceAdmits`. The CSP grammar would
   * have a port-less host match only the scheme's default port; refining that
   * can only ever turn an `allowed` into a `blocked`, which is the expensive
   * direction.
   */
  it("does not let a non-default port turn a named host into a refusal", () => {
    expect(verdict(null, "frame-ancestors cosetup.net", "https://cosetup.net:8443")).toBe(
      "allowed",
    );
  });
});

describe("isPubliclyRoutable — the SSRF list (§88)", () => {
  it("accepts ordinary public addresses", () => {
    for (const address of ["93.184.216.34", "1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) {
      expect(isPubliclyRoutable(address), address).toBe(true);
    }
  });

  it("refuses loopback, RFC1918 and the rest of the private v4 space", () => {
    for (const address of [
      "127.0.0.1",
      "127.53.1.9",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "0.0.0.0",
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPubliclyRoutable(address), address).toBe(false);
    }
  });

  /** The whole reason SSRF is worth exploiting on a cloud host. */
  it("refuses the link-local range, including the metadata endpoint", () => {
    expect(isPubliclyRoutable("169.254.169.254")).toBe(false);
    expect(isPubliclyRoutable("169.254.0.1")).toBe(false);
  });

  /**
   * The regression `npm run frame:probe` found and this file had not.
   *
   * The reserved blocks here are /24s, not /16s, and an earlier version matched them
   * on two octets — which took `192.0.0.0/16`, `198.51.0.0/16` and
   * `203.0.0.0/16` out of the public internet. Nothing caught it, because every
   * address anyone writes down as an example sits inside the /24 that really is
   * reserved. `iana.org` is `192.0.43.8`, and the probe refused to contact it.
   */
  it("refuses only the reserved /24, not the whole /16 around it", () => {
    expect(isPubliclyRoutable("192.0.43.8"), "iana.org").toBe(true);
    expect(isPubliclyRoutable("198.51.99.1")).toBe(true);
    expect(isPubliclyRoutable("203.0.112.1")).toBe(true);

    expect(isPubliclyRoutable("192.0.0.1")).toBe(false);
    expect(isPubliclyRoutable("192.0.2.1")).toBe(false);
    expect(isPubliclyRoutable("192.88.99.1")).toBe(false);
    expect(isPubliclyRoutable("198.51.100.1")).toBe(false);
    expect(isPubliclyRoutable("203.0.113.1")).toBe(false);
  });

  it("refuses a malformed dotted quad rather than reading past it", () => {
    for (const value of ["1.2.3", "1.2.3.4.5", "999.1.1.1", "1.2.3.-1"]) {
      expect(isPubliclyRoutable(value), value).toBe(false);
    }
  });

  it("keeps 172.x addresses outside the private block public", () => {
    // The off-by-one that makes this range worth testing: only 172.16–172.31.
    expect(isPubliclyRoutable("172.15.0.1")).toBe(true);
    expect(isPubliclyRoutable("172.32.0.1")).toBe(true);
  });

  it("refuses the v6 equivalents", () => {
    for (const address of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
    ]) {
      expect(isPubliclyRoutable(address), address).toBe(false);
    }
  });

  /** An IPv4 address wearing a costume — the standard way past a v6-only check. */
  it("looks through an IPv4-mapped v6 address to the v4 rules", () => {
    expect(isPubliclyRoutable("::ffff:127.0.0.1")).toBe(false);
    expect(isPubliclyRoutable("::ffff:169.254.169.254")).toBe(false);
    expect(isPubliclyRoutable("::ffff:93.184.216.34")).toBe(true);
  });

  it("refuses anything that is not an IP literal at all", () => {
    // Nothing reaches it that has not been through `lookup()`; a hostname here
    // would mean a caller skipped the resolution step.
    for (const value of ["localhost", "example.com", "", "not an address"]) {
      expect(isPubliclyRoutable(value), value).toBe(false);
    }
  });
});
