import { describe, expect, it } from "vitest";
import { STOREFRONT_FIELDS } from "@/config/storefront";
import {
  hiddenStorefrontFields,
  resolveStorefrontVisibility,
  visibilityOf,
} from "./storefront-visibility";

/**
 * The two-level rule, tested without a database.
 *
 * `resolveStorefrontVisibility` takes both levels as arguments precisely so this
 * file can exist — it is a rule about who sees what, which is the kind of thing
 * that should be checkable in milliseconds rather than behind seven minutes of
 * mongod.
 */

const NONE = {};

describe("resolveStorefrontVisibility", () => {
  /**
   * The property that makes this change invisible on deploy. An empty
   * `storefrontSettings` collection and a vendor nobody has moderated must
   * render the storefront that existed before any of this.
   */
  it("shows everything when nothing anywhere has been decided", () => {
    const visibility = resolveStorefrontVisibility(null, NONE);

    for (const field of STOREFRONT_FIELDS) {
      expect(visibility[field]).toBe(true);
    }
  });

  it("returns every field, so no caller can read an undefined", () => {
    expect(Object.keys(resolveStorefrontVisibility(null, NONE)).sort()).toEqual(
      [...STOREFRONT_FIELDS].sort(),
    );
  });

  it("applies a platform default to a vendor with no override", () => {
    const visibility = resolveStorefrontVisibility(undefined, { website: false });

    expect(visibility.website).toBe(false);
    expect(visibility.summary).toBe(true);
  });

  /**
   * The case both levels exist for: a platform-wide switch-off during an
   * incident, with one trusted vendor exempted. A single-level design gets this
   * wrong, and gets it wrong silently.
   */
  it("lets a vendor override beat the platform default in both directions", () => {
    expect(
      resolveStorefrontVisibility(
        { storefrontVisibility: { website: true } },
        { website: false },
      ).website,
    ).toBe(true);

    expect(
      resolveStorefrontVisibility(
        { storefrontVisibility: { website: false } },
        { website: true },
      ).website,
    ).toBe(false);
  });

  /**
   * `false` is a decision and `undefined` is the absence of one. If a falsy
   * check ever creeps into the resolver, "always show" collapses into "not set"
   * and the exemption above stops working — quietly, and only when the platform
   * default is off.
   */
  it("does not confuse an explicit false with an absent key", () => {
    const explicit = resolveStorefrontVisibility(
      { storefrontVisibility: { logo: false } },
      { logo: true },
    );
    const absent = resolveStorefrontVisibility({ storefrontVisibility: {} }, { logo: true });

    expect(explicit.logo).toBe(false);
    expect(absent.logo).toBe(true);
  });
});

describe("visibilityOf — the level, which the staff screen renders", () => {
  it("names the level that supplied the answer", () => {
    expect(visibilityOf(null, NONE, "cover")).toEqual({ shown: true, source: "default" });

    expect(visibilityOf(null, { cover: false }, "cover")).toEqual({
      shown: false,
      source: "platform",
    });

    expect(
      visibilityOf({ storefrontVisibility: { cover: true } }, { cover: false }, "cover"),
    ).toEqual({ shown: true, source: "vendor" });
  });

  /**
   * A vendor override of `true` over a platform `true` is still an override —
   * the staff screen must show the radio on "Always show", not on "Use default",
   * or saving the form would silently discard the decision.
   */
  it("reports a vendor source even when it agrees with the platform", () => {
    expect(
      visibilityOf({ storefrontVisibility: { logo: true } }, { logo: true }, "logo").source,
    ).toBe("vendor");
  });
});

describe("hiddenStorefrontFields", () => {
  it("is empty when everything is shown", () => {
    expect(hiddenStorefrontFields(resolveStorefrontVisibility(null, NONE))).toEqual([]);
  });

  it("names what a vendor has had switched off", () => {
    const visibility = resolveStorefrontVisibility(
      { storefrontVisibility: { website: false } },
      { cover: false },
    );

    expect(hiddenStorefrontFields(visibility)).toEqual(["cover", "website"]);
  });
});
