import { describe, expect, it } from "vitest";
import { isForbiddenAddress } from "./fetcher";

/**
 * The address filter, on its own — vendor ticket 06.
 *
 * `assertFetchable` needs DNS and `fetchRemoteArtefact` needs the network, so both
 * belong in a probe. This is the part that is pure, and it is the part where a mistake
 * is a server-side request forgery rather than a failed download: the caller chooses
 * the address and this process sits inside a network nobody outside it can reach.
 *
 * Written as "what must be refused" rather than "what is allowed", because the failure
 * that matters is a range someone forgot.
 */

describe("isForbiddenAddress", () => {
  /**
   * The one that is the reason this exists. On most cloud providers `169.254.169.254`
   * serves instance credentials to anything that asks it.
   */
  it("refuses the cloud metadata endpoint", () => {
    expect(isForbiddenAddress("169.254.169.254")).toBe(true);
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["loopback, other host in range", "127.1.2.3"],
    ["this network", "0.0.0.0"],
    ["private 10/8", "10.0.0.1"],
    ["private 172.16/12 low", "172.16.0.1"],
    ["private 172.16/12 high", "172.31.255.254"],
    ["private 192.168/16", "192.168.1.1"],
    ["link-local", "169.254.1.1"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["IETF protocol assignments", "192.0.0.1"],
    ["TEST-NET-1", "192.0.2.1"],
    ["benchmarking", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["reserved", "255.255.255.255"],
  ])("refuses IPv4 %s (%s)", (_label, address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it.each([
    ["a public address", "93.184.216.34"],
    ["just outside 172.16/12", "172.32.0.1"],
    ["just below 172.16/12", "172.15.255.254"],
    ["not 192.168", "192.169.0.1"],
    ["not link-local", "169.253.0.1"],
    ["just outside CGNAT", "100.128.0.1"],
  ])("allows IPv4 %s (%s)", (_label, address) => {
    expect(isForbiddenAddress(address)).toBe(false);
  });

  it.each([
    ["loopback", "::1"],
    ["unspecified", "::"],
    ["link-local", "fe80::1"],
    ["link-local, upper", "FE80::1"],
    ["unique-local fc00::/7", "fc00::1"],
    ["unique-local fd00::/8", "fd12:3456::1"],
    ["multicast", "ff02::1"],
  ])("refuses IPv6 %s (%s)", (_label, address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  /**
   * The trap worth a test of its own: an IPv4-mapped IPv6 address is an IPv4 address
   * wearing a hat. Judging `::ffff:10.0.0.1` by its v6 prefix waves every private
   * range straight through, and it looks like a v6 address to every eye and most
   * regexes.
   */
  it("refuses an IPv4-mapped IPv6 address pointing somewhere private", () => {
    expect(isForbiddenAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isForbiddenAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isForbiddenAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows an IPv4-mapped IPv6 address pointing somewhere public", () => {
    expect(isForbiddenAddress("::ffff:93.184.216.34")).toBe(false);
  });

  it("allows an ordinary public IPv6 address", () => {
    expect(isForbiddenAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  /**
   * Anything unparseable is refused rather than passed through. A filter that lets
   * through what it cannot classify is a filter that fails open, and this one guards a
   * process with network positions nobody outside has.
   */
  it.each([
    ["empty", ""],
    ["a hostname", "example.com"],
    ["nonsense", "not-an-address"],
    ["a truncated v4", "10.0.0"],
    ["out of range", "999.1.1.1"],
  ])("refuses what it cannot parse: %s", (_label, address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });
});
