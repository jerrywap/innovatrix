import { describe, expect, it } from "vitest";
import { enhancedProseSchema, proposedFeaturesSchema } from "./authoring";

/**
 * The two schemas, and the drift between each and its JSON-Schema twin.
 *
 * `summary.ts` explains why both are written by hand: `strict: true` requires
 * every property in `required` and `additionalProperties: false` throughout, and
 * the generators disagree about optionals under that constraint. The cost of
 * writing both is that they can disagree, and the Zod parse is what catches it —
 * at runtime, on a paid call, in front of whoever pressed the button.
 *
 * These run in milliseconds instead.
 */

describe("enhancedProseSchema", () => {
  it("accepts a rewrite", () => {
    expect(enhancedProseSchema.parse({ text: "  A booking tool for clinics.  " })).toEqual({
      text: "A booking tool for clinics.",
    });
  });

  /**
   * A model that returns `{ text: "" }` has failed, and the pane must not open
   * with an empty side and a button offering to replace the author's work with
   * nothing.
   */
  it("rejects an empty rewrite", () => {
    expect(enhancedProseSchema.safeParse({ text: "" }).success).toBe(false);
    expect(enhancedProseSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  /**
   * Deliberately above `productBasicsSchema`'s own 300-character summary cap.
   * A model asked for one line sometimes returns two, and putting that in the
   * editable pane where the author can cut it beats an error they cannot act on.
   * The form's validation still refuses to save one that is too long.
   */
  it("allows more than the field itself will, so a long answer is editable rather than an error", () => {
    expect(enhancedProseSchema.safeParse({ text: "x".repeat(1000) }).success).toBe(true);
    expect(enhancedProseSchema.safeParse({ text: "x".repeat(8001) }).success).toBe(false);
  });
});

describe("proposedFeaturesSchema", () => {
  const feature = (title: string, detail?: string) => ({
    title,
    ...(detail ? { detail } : {}),
  });

  it("accepts a list", () => {
    const parsed = proposedFeaturesSchema.parse({
      features: [
        feature("Online booking", "Takes bookings around the clock."),
        feature("Rotas"),
      ],
    });

    expect(parsed.features).toHaveLength(2);
    expect(parsed.features[1]).toEqual({ title: "Rotas" });
  });

  it("rejects a feature with no title", () => {
    expect(proposedFeaturesSchema.safeParse({ features: [feature("")] }).success).toBe(false);
  });

  /**
   * An empty proposal is a failed call wearing a success. The modal would open
   * offering to replace the author's features with nothing.
   */
  it("rejects an empty list", () => {
    expect(proposedFeaturesSchema.safeParse({ features: [] }).success).toBe(false);
  });

  /**
   * Twelve, not `productContentSchema`'s sixty. A proposal that long is a list
   * nobody reads, and capping it here is kinder than making the author delete
   * fifty rows out of the modal.
   */
  it("caps a proposal well below what the form itself allows", () => {
    const many = (n: number) => ({
      features: Array.from({ length: n }, (_, i) => feature(`Feature ${i}`)),
    });

    expect(proposedFeaturesSchema.safeParse(many(12)).success).toBe(true);
    expect(proposedFeaturesSchema.safeParse(many(13)).success).toBe(false);
  });

  it("holds each field to what the form will accept", () => {
    expect(
      proposedFeaturesSchema.safeParse({ features: [feature("x".repeat(121))] }).success,
    ).toBe(false);
    expect(
      proposedFeaturesSchema.safeParse({ features: [feature("Fine", "y".repeat(501))] })
        .success,
    ).toBe(false);
  });
});
