import { describe, expect, it } from "vitest";
import {
  compareSemver,
  isFreeUpgrade,
  isSemver,
  parseSemver,
  sortByVersionDesc,
  supersedes,
} from "./semver";

describe("parseSemver", () => {
  it("parses the three parts", () => {
    expect(parseSemver("2.4.1")).toMatchObject({ major: 2, minor: 4, patch: 1 });
  });

  it("splits a prerelease into identifiers, numbering the numeric ones", () => {
    expect(parseSemver("1.0.0-rc.2")?.prerelease).toEqual(["rc", 2]);
  });

  it("carries build metadata without treating it as a prerelease", () => {
    const parsed = parseSemver("1.0.0+build.7");
    expect(parsed?.build).toBe("build.7");
    expect(parsed?.prerelease).toEqual([]);
  });

  const rejected = [
    ["a partial version", "1.2"],
    ["a v prefix", "v1.2.3"],
    ["a range", ">=1.2.3"],
    ["a wildcard", "1.2.x"],
    // `1.01.0` and `1.1.0` would otherwise be two different versions of one
    // product that a human reads as the same release.
    ["a leading zero", "1.01.0"],
    ["four parts", "1.2.3.4"],
    ["empty", ""],
  ] as const;

  it.each(rejected)("rejects %s", (_label, value) => {
    expect(parseSemver(value)).toBeNull();
    expect(isSemver(value)).toBe(false);
  });
});

describe("compareSemver", () => {
  it("compares numerically, not lexicographically", () => {
    // The bug this exists to prevent: as strings, "9" > "10".
    expect(compareSemver("1.9.0", "1.10.0")).toBe(-1);
    expect(compareSemver("2.0.0", "10.0.0")).toBe(-1);
  });

  it("sorts a prerelease below its own release", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
  });

  it("orders prerelease identifiers by the spec's rules", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1); // numeric
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1); // longer wins
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1); // numeric < alnum
  });

  it("ignores build metadata", () => {
    expect(compareSemver("1.0.0+a", "1.0.0+b")).toBe(0);
  });

  it("does not throw on a stored value that will not parse", () => {
    // Runs over database rows; one bad row must not break the version list.
    expect(() => compareSemver("not-a-version", "1.0.0")).not.toThrow();
    expect(compareSemver("not-a-version", "1.0.0")).toBe(-1);
  });
});

describe("sortByVersionDesc", () => {
  it("puts the newest release first and rcs below their release", () => {
    const rows = ["1.0.0", "1.10.0", "1.9.0", "2.0.0-rc.1", "2.0.0"].map((v) => ({ v }));
    expect(sortByVersionDesc(rows, (r) => r.v).map((r) => r.v)).toEqual([
      "2.0.0",
      "2.0.0-rc.1",
      "1.10.0",
      "1.9.0",
      "1.0.0",
    ]);
  });
});

describe("supersedes", () => {
  it("is true against nothing, and only for a strictly newer version", () => {
    expect(supersedes("1.0.0", undefined)).toBe(true);
    expect(supersedes("1.0.1", "1.0.0")).toBe(true);
    expect(supersedes("1.0.0", "1.0.0")).toBe(false);
    // The pointer only moves forward: re-releasing an old version must not
    // drag `currentVersionId` backwards.
    expect(supersedes("1.0.0", "2.0.0")).toBe(false);
  });
});

describe("isFreeUpgrade — §45, the rule ticket 14 enforces", () => {
  it("gives minor and patch releases away within a major", () => {
    expect(isFreeUpgrade("2.5.0", "2.4.0", undefined)).toBe(true);
    expect(isFreeUpgrade("2.4.1", "2.4.0", undefined)).toBe(true);
  });

  it("charges for a new major by default", () => {
    expect(isFreeUpgrade("3.0.0", "2.4.0", undefined)).toBe(false);
  });

  it("gives the new major away when the release says so", () => {
    expect(isFreeUpgrade("3.0.0", "2.4.0", { includesPriorMajor: true })).toBe(true);
  });

  it("lets an explicit floor both widen and narrow the default", () => {
    // Widen: 1.x owners included, which the major rule would exclude.
    expect(isFreeUpgrade("3.0.0", "1.9.0", { freeFromVersion: "1.5.0" })).toBe(true);
    // Narrow: within the same major, but below the floor.
    expect(isFreeUpgrade("2.9.0", "2.1.0", { freeFromVersion: "2.5.0" })).toBe(false);
  });

  it("is never true for a version you already own or have passed", () => {
    expect(isFreeUpgrade("2.4.0", "2.4.0", { includesPriorMajor: true })).toBe(false);
    expect(isFreeUpgrade("2.3.0", "2.4.0", { includesPriorMajor: true })).toBe(false);
  });
});
