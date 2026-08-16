import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Structural assertions about the product page's source.
 *
 * ## Why a source-text test rather than a rendering test
 *
 * The §100 criterion is about **ordering**:
 *
 * > A non-technical visitor can understand what the product does without
 * > meeting the words "framework", "ORM" or "deployment" above the technical
 * > section.
 *
 * Rendering the page would prove it for one product's data. What actually
 * decays is the *page*, when somebody adds a paragraph about the ORM to the
 * overview six months from now. Reading the source is the only way to catch
 * that, and it makes a review opinion mechanical.
 */

const pagePath = fileURLToPath(
  new URL("../../app/(public)/marketplace/[slug]/page.tsx", import.meta.url),
);
const source = readFileSync(pagePath, "utf8");

/**
 * The source with comments removed.
 *
 * Necessary before anything else: the page's own doc comment quotes the
 * criterion, mentions `<TechnicalSection>` and names all three forbidden words.
 * Searching the raw text finds the *comment* rather than the markup, which
 * makes every assertion below meaningless — and it passed nothing, which is how
 * this was caught.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** Everything before the `<TechnicalSection>` boundary, comments stripped. */
function aboveTheTechnicalSection(): string {
  const index = code.indexOf("<TechnicalSection");
  expect(index, "the page must render a <TechnicalSection> boundary").toBeGreaterThan(0);
  return code.slice(0, index);
}

describe("§100 — business language above the technical section", () => {
  // Whole words. A substring check for "ORM" matches "platform", "form" and
  // "information" — it would fail on copy that is perfectly fine.
  const forbidden: Array<[string, RegExp]> = [
    ["framework", /\bframeworks?\b/i],
    ["ORM", /\bORMs?\b/],
    ["deployment", /\bdeploy(ment|ed|ing)?\b/i],
  ];

  it.each(forbidden)("does not use %s above the boundary", (_label, pattern) => {
    expect(aboveTheTechnicalSection()).not.toMatch(pattern);
  });

  it("puts 'what you get' above the technical section", () => {
    // The licence, support window and update window are what a business owner
    // is deciding on. Below a stack list, they answer the wrong person.
    const above = aboveTheTechnicalSection();
    expect(above).toContain("<WhatYouGet");
    expect(above).toContain("<Installation");
  });

  it("puts the demo panel above the technical section too", () => {
    expect(aboveTheTechnicalSection()).toContain("<DemoPanel");
  });
});

describe("the hero image is the LCP element", () => {
  it("renders it as a plain next/image with priority, not inside the gallery island", () => {
    const above = aboveTheTechnicalSection();
    const heroBlock = above.slice(above.indexOf("{hero &&"), above.indexOf("<Gallery"));
    expect(heroBlock.length, "the hero block should exist").toBeGreaterThan(0);

    // An LCP that waits for a client bundle to download, parse and hydrate
    // misses 2.5s on a throttled connection for no benefit — nobody opens a
    // lightbox before the page has painted.
    expect(heroBlock).toContain("priority");
    expect(heroBlock).toContain("<Image");
  });
});

describe("the page's dynamic parts are suspended", () => {
  it("wraps every request-dependent subtree in Suspense", () => {
    // Each of these reads cookies or the session. Un-suspended, any one of
    // them would stop the whole route prerendering.
    //
    // Recently-viewed is *not* in this list: it is written in `proxy.ts`,
    // because Next.js does not permit a Server Component to set a cookie.
    for (const component of ["<DemoPanel", "<PurchaseSection", "<RelatedProducts"]) {
      const at = code.indexOf(component);
      expect(at, `${component} should be rendered`).toBeGreaterThan(0);

      const preceding = code.slice(Math.max(0, at - 400), at);
      expect(preceding, `${component} must be inside a <Suspense>`).toContain("<Suspense");
    }
  });

  it("does not carry a Cache Components opt-out", () => {
    // `instant = false` here would defeat the whole Suspense structure above.
    expect(source).not.toContain("instant = false");
  });
});

describe("a moved product redirects rather than 404s", () => {
  it("checks slugHistory before giving up", () => {
    const notFoundAt = code.indexOf("notFound()");
    const historyAt = code.lastIndexOf("getCurrentSlugFor");

    expect(historyAt).toBeGreaterThan(0);
    // Order matters: a 404 for a renamed product throws away every link
    // anyone has shared.
    expect(historyAt).toBeLessThan(notFoundAt);
    expect(source).toContain("permanentRedirect");
  });
});
