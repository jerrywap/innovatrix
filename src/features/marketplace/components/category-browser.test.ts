import { describe, expect, it } from "vitest";
import { categoryImage } from "./category-browser";

/**
 * Which picture a category card shows.
 *
 * Three branches, and the last is the one that earns the test: without it a tile
 * renders an empty box, which is the state most categories are in before anybody
 * uploads anything.
 */
describe("categoryImage", () => {
  const PREVIEW = { url: "https://cdn/product.png", alt: "Atlas CRM" };

  it("prefers an uploaded override", () => {
    const image = categoryImage({ name: "CRM", imageUrl: "https://cdn/crm.png" }, PREVIEW);
    expect(image?.url).toBe("https://cdn/crm.png");
  });

  it("falls back to the category's best-selling product", () => {
    expect(categoryImage({ name: "CRM" }, PREVIEW)).toEqual(PREVIEW);
  });

  it("returns nothing when there is neither, so the tile draws its gradient", () => {
    // Not an empty string or a placeholder URL: the card branches on `undefined`
    // to render `gradientFor`, and a truthy value would send `next/image` at a
    // resource that does not exist.
    expect(categoryImage({ name: "CRM" }, undefined)).toBeUndefined();
  });

  it("blanks the alt on an override, because nobody supplies one", () => {
    // The product fallback has a real alt — the product's name. An uploaded
    // image has no caption anywhere in the admin form, and inventing one from
    // the category name would describe the *label beside it*, which a screen
    // reader is about to read anyway.
    expect(categoryImage({ name: "CRM", imageUrl: "https://cdn/crm.png" }, PREVIEW)?.alt).toBe(
      "",
    );
  });
});
