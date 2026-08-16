import { describe, expect, it } from "vitest";
import { computeReadiness, type ReadinessSnapshot } from "./readiness";

/** A product with nothing missing. Each case removes exactly one thing. */
const complete: ReadinessSnapshot = {
  status: "ready",
  priceCount: 3,
  licencePackageCount: 1,
  screenshotCount: 2,
  hasDescription: true,
  hasReleasedVersion: true,
  hasReleasedVersionWithPackage: true,
  checklist: [{ status: "pass" }, { status: "pass" }],
};

const codes = (snapshot: Partial<ReadinessSnapshot>) =>
  computeReadiness({ ...complete, ...snapshot }).gaps.map((gap) => gap.code);

describe("computeReadiness", () => {
  it("finds nothing wrong with a complete product", () => {
    const result = computeReadiness(complete);
    expect(result.gaps).toEqual([]);
    expect(result.isPublishable).toBe(true);
    expect(result.isTestingComplete).toBe(true);
  });

  it.each([
    ["no price", { priceCount: 0 }, "no_price"],
    ["no licence package", { licencePackageCount: 0 }, "no_licence_package"],
    ["no screenshot", { screenshotCount: 0 }, "no_screenshot"],
    ["no description", { hasDescription: false }, "no_description"],
    ["no released version", { hasReleasedVersion: false }, "no_released_version"],
  ])("reports %s as exactly one gap", (_label, snapshot, expected) => {
    // One missing thing produces one gap — not a cascade the reader has to
    // work through to find the real problem.
    expect(codes(snapshot)).toEqual([expected]);
  });

  /**
   * The subtler failure: a released version with nothing attached. The product
   * looks complete right up until someone pays for it.
   */
  it("distinguishes no version at all from a version with no package", () => {
    expect(codes({ hasReleasedVersion: false, hasReleasedVersionWithPackage: false })).toEqual([
      "no_released_version",
    ]);
    expect(codes({ hasReleasedVersionWithPackage: false })).toEqual(["no_package_file"]);
  });

  it("reports every gap at once, so publishing is not whack-a-mole", () => {
    const result = computeReadiness({
      ...complete,
      priceCount: 0,
      screenshotCount: 0,
      licencePackageCount: 0,
    });
    expect(result.gaps).toHaveLength(3);
    expect(result.isPublishable).toBe(false);
  });

  it("points each gap at the section that fixes it", () => {
    // This is what makes the list column's links work, and why the codes are
    // stable rather than derived from the message.
    const byCode = new Map(
      computeReadiness({
        ...complete,
        priceCount: 0,
        screenshotCount: 0,
        hasReleasedVersion: false,
      }).gaps.map((gap) => [gap.code, gap.section]),
    );

    expect(byCode.get("no_price")).toBe("pricing");
    expect(byCode.get("no_screenshot")).toBe("media");
    expect(byCode.get("no_released_version")).toBe("versions");
  });
});

describe("the §47 testing checklist", () => {
  it("treats an empty checklist as incomplete, not as complete", () => {
    // Never tested and passed everything must not look the same. This is the
    // whole point of the checklist.
    const result = computeReadiness({ ...complete, checklist: [] });
    expect(result.isTestingComplete).toBe(false);
    expect(result.gaps.map((g) => g.code)).toContain("testing_incomplete");
  });

  it("blocks on a pending item", () => {
    expect(codes({ checklist: [{ status: "pass" }, { status: "pending" }] })).toEqual([
      "testing_incomplete",
    ]);
  });

  it("blocks on a failure, and says so differently from being unfinished", () => {
    // "Resolve the failed check" and "finish the checklist" are different jobs.
    expect(codes({ checklist: [{ status: "pass" }, { status: "fail" }] })).toEqual([
      "testing_failed",
    ]);
  });

  it("accepts n/a only when it carries a note", () => {
    // Without a note, `na` is indistinguishable from clicking through.
    expect(
      computeReadiness({
        ...complete,
        checklist: [{ status: "pass" }, { status: "na", notes: "No payment integration" }],
      }).isTestingComplete,
    ).toBe(true);

    expect(
      computeReadiness({ ...complete, checklist: [{ status: "na" }] }).isTestingComplete,
    ).toBe(false);
  });

  it("does not accept whitespace as a note", () => {
    expect(
      computeReadiness({ ...complete, checklist: [{ status: "na", notes: "   " }] })
        .isTestingComplete,
    ).toBe(false);
  });

  it("reports a failure ahead of incompleteness when both apply", () => {
    const result = computeReadiness({
      ...complete,
      checklist: [{ status: "fail" }, { status: "pending" }],
    });
    expect(result.gaps.map((g) => g.code)).toEqual(["testing_failed"]);
  });
});
