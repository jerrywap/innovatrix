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
  catalogue: "script",
  catalogueCategoryCount: 1,
};

const codes = (snapshot: Partial<ReadinessSnapshot>) =>
  computeReadiness({ ...complete, ...snapshot }).gaps.map((gap) => gap.code);

describe("the catalogue gate", () => {
  it("refuses a template with no template category", () => {
    // `/templates` browses by category, so one with none is only reachable from
    // the unfiltered grid — and drops off it the moment anybody filters.
    expect(codes({ catalogue: "template", catalogueCategoryCount: 0 })).toContain(
      "no_template_category",
    );
  });

  it("leaves a script with no category alone", () => {
    // Publishable without one since ticket 06. Gating it now would retro-flag
    // every published product, which is a different decision.
    expect(codes({ catalogue: "script", catalogueCategoryCount: 0 })).not.toContain(
      "no_template_category",
    );
  });
});

describe("an inherited description", () => {
  const message = (snapshot: Partial<ReadinessSnapshot>) =>
    computeReadiness({ ...complete, ...snapshot, descriptionInherited: true }).gaps.find(
      (gap) => gap.code === "description_inherited",
    )?.message;

  it("tells a template the prose promises a backend it does not have", () => {
    expect(message({ catalogue: "template" })).toContain("describes a backend");
  });

  it("tells a script the prose describes only the front-end", () => {
    /*
     * COS-9 made the pair buildable from either end, and the two mistakes are
     * opposites. Wording both from the template's side would tell a backend script
     * that it lacks a backend.
     */
    const script = message({ catalogue: "script" });
    expect(script).toContain("front-end");
    expect(script).not.toContain("describes a backend this template does not have");
  });
});

describe("computeReadiness", () => {
  it("finds nothing wrong with a complete product", () => {
    const result = computeReadiness(complete);
    expect(result.gaps).toEqual([]);
    expect(result.isPublishable).toBe(true);
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
