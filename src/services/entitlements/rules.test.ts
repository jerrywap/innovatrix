import { describe, expect, it } from "vitest";
import { compareSemver } from "@/lib/semver";
import { availableUpdate, canDownload, hasSupport, type EntitlementFacts } from "./rules";

/**
 * The rule that decides whether somebody who paid gets their file.
 *
 * Both failure directions are expensive and neither is loud: refusing a
 * legitimate download is a support ticket from a paying customer, and allowing
 * one outside the window is software given away.
 */

const JAN = new Date("2026-01-01T00:00:00Z");
const JUN = new Date("2026-06-01T00:00:00Z");
const DEC = new Date("2026-12-01T00:00:00Z");
const NEXT_JUN = new Date("2027-06-01T00:00:00Z");

const owned: EntitlementFacts = {
  status: "active",
  purchasedVersionId: "v1",
  updatesUntil: DEC,
};

const version = (
  id: string,
  releasedAt: Date,
  status: "draft" | "released" | "deprecated" = "released",
) => ({ id, status, releasedAt, version: id.replace("v", "") + ".0.0" });

describe("the version you bought is yours forever", () => {
  it("stays downloadable after the update window closes", () => {
    // §45. An update window that lapses stops *new* releases; it does not
    // repossess the software. Getting this wrong takes away what somebody owns.
    const expired: EntitlementFacts = { ...owned, updatesUntil: JAN };
    expect(canDownload(expired, version("v1", JAN)).allowed).toBe(true);
  });

  it("stays downloadable even if that version is later deprecated", () => {
    expect(canDownload(owned, version("v1", JAN, "deprecated")).allowed).toBe(true);
  });

  it("is checked before the window, not after", () => {
    // Ordering matters: the purchased-version escape has to run first, or an
    // expired window rejects it on the way past.
    const longExpired: EntitlementFacts = {
      status: "active",
      purchasedVersionId: "v1",
      updatesUntil: new Date("2020-01-01T00:00:00Z"),
    };
    expect(canDownload(longExpired, version("v1", JAN)).allowed).toBe(true);
  });
});

describe("newer versions, inside and outside the window", () => {
  it("allows one released within the window", () => {
    expect(canDownload(owned, version("v2", JUN)).allowed).toBe(true);
  });

  it("allows one released exactly on the boundary", () => {
    // "on or before `updatesUntil`" — an off-by-one here charges somebody for a
    // release they were entitled to by a second.
    expect(canDownload(owned, version("v2", DEC)).allowed).toBe(true);
  });

  it("refuses one released after the window, in plain language", () => {
    const decision = canDownload(owned, version("v3", NEXT_JUN));

    expect(decision.allowed).toBe(false);
    expect(decision.refusal).toBe("outside_update_window");
    // The message says the purchased version is still available and how to
    // extend — a bare "not entitled" reads as "we lost your purchase".
    expect(decision.message).toMatch(/stays available/i);
    expect(decision.message).toMatch(/extend updates/i);
  });

  it("refuses everything newer when there is no update window at all", () => {
    const noUpdates: EntitlementFacts = { status: "active", purchasedVersionId: "v1" };
    expect(canDownload(noUpdates, version("v2", JUN)).allowed).toBe(false);
    // But not the purchased one.
    expect(canDownload(noUpdates, version("v1", JAN)).allowed).toBe(true);
  });
});

describe("version status", () => {
  it("refuses a draft — staff work in progress", () => {
    expect(canDownload(owned, version("v2", JUN, "draft")).refusal).toBe(
      "version_not_released",
    );
  });

  it("allows a deprecated version inside the window", () => {
    // Withdrawn from sale, not recalled. Somebody running it in production may
    // legitimately need to reinstall.
    expect(canDownload(owned, version("v2", JUN, "deprecated")).allowed).toBe(true);
  });

  it("refuses a released version with no release date", () => {
    expect(canDownload(owned, { id: "v2", status: "released" }).refusal).toBe(
      "version_not_released",
    );
  });
});

describe("entitlement status", () => {
  it("refuses a suspended entitlement, including its purchased version", () => {
    // A refund suspends. Until it resolves, nothing downloads — not even what
    // they originally bought.
    const suspended: EntitlementFacts = { ...owned, status: "suspended" };
    expect(canDownload(suspended, version("v1", JAN)).refusal).toBe("entitlement_suspended");
    expect(canDownload(suspended, version("v2", JUN)).refusal).toBe("entitlement_suspended");
  });

  it("refuses a revoked one and says so differently", () => {
    const revoked: EntitlementFacts = { ...owned, status: "revoked" };
    const decision = canDownload(revoked, version("v1", JAN));

    expect(decision.refusal).toBe("entitlement_revoked");
    // Suspended is recoverable and revoked is not, so the two must not share
    // a message.
    expect(decision.message).not.toBe(
      canDownload({ ...owned, status: "suspended" }, version("v1", JAN)).message,
    );
  });
});

describe("availableUpdate — the 'Update available' badge", () => {
  const versions = [version("v1", JAN), version("v2", JUN), version("v3", NEXT_JUN)];

  it("finds the newest version inside the window", () => {
    expect(availableUpdate(owned, versions, compareSemver, "1.0.0")?.id).toBe("v2");
  });

  it("does not offer one outside the window", () => {
    // The acceptance criterion: the badge appears only when the newer version
    // is *genuinely* within the window. It runs `canDownload` rather than
    // comparing version numbers and hoping.
    const narrow: EntitlementFacts = { ...owned, updatesUntil: new Date("2026-02-01") };
    expect(availableUpdate(narrow, versions, compareSemver, "1.0.0")).toBeUndefined();
  });

  it("offers nothing when the customer already has the newest", () => {
    expect(
      availableUpdate(owned, [version("v1", JAN)], compareSemver, "1.0.0"),
    ).toBeUndefined();
  });

  it("offers nothing for a suspended entitlement", () => {
    const suspended: EntitlementFacts = { ...owned, status: "suspended" };
    expect(availableUpdate(suspended, versions, compareSemver, "1.0.0")).toBeUndefined();
  });

  it("ignores drafts", () => {
    const withDraft = [...versions.slice(0, 2), version("v9", JUN, "draft")];
    expect(availableUpdate(owned, withDraft, compareSemver, "1.0.0")?.id).toBe("v2");
  });
});

describe("hasSupport", () => {
  it("is independent of the update window", () => {
    // Sold separately (§65) and they expire separately: a customer can be
    // entitled to a download and not to help installing it.
    expect(hasSupport(DEC, JUN)).toBe(true);
    expect(hasSupport(JAN, JUN)).toBe(false);
    expect(hasSupport(undefined, JUN)).toBe(false);
  });
});
