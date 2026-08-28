import { describe, expect, it } from "vitest";
import { parseLegalDocument, type LegalBlock } from "./document";
import { PRIVACY_POLICY } from "./privacy-policy";
import { TERMS_OF_SERVICE } from "./terms-of-service";

/**
 * The parser, against the two documents it exists to render.
 *
 * ## Why this earns a test when a page composing view models does not
 *
 * Because the failure is silent and the stakes are a contract. A parser that
 * quietly drops a clause renders a page that looks complete, reads fluently and
 * is missing a limitation of liability. Nothing else would notice: there is no
 * type error, no empty state, no exception — just a shorter page than the one
 * that was signed off.
 *
 * The first version of the parser did exactly that. `# Summary` at the end of
 * the terms has seven paragraphs and no `##` under it, and with nowhere to put
 * them they fell through to the preamble and rendered the closing summary at the
 * *top* of the document. It was found by this test, not by reading the page.
 *
 * ## The containment check is the point
 *
 * Structure assertions are the easy half. The one that matters walks every
 * non-blank line of the source and insists its text appears somewhere in the
 * output — so a revision that introduces a construct the parser does not know
 * fails here rather than losing a paragraph in production.
 */

const DOCUMENTS = [
  ["the privacy policy", PRIVACY_POLICY],
  ["the terms of service", TERMS_OF_SERVICE],
] as const;

/** Every string the parser would render, in document order. */
function renderedText(source: string): string {
  const document = parseLegalDocument(source);
  const out: string[] = [];
  const push = (blocks: readonly LegalBlock[]) =>
    blocks.forEach((block) => out.push(...block.lines));

  push(document.preamble);

  for (const part of document.parts) {
    if (part.heading) out.push(part.heading);
    push(part.blocks);

    for (const section of part.sections) {
      out.push(section.number ? `${section.number}. ${section.heading}` : section.heading);
      push(section.blocks);
    }
  }

  return out.join("\n");
}

describe.each(DOCUMENTS)("%s", (_name, source) => {
  /** The assertion this file exists for. */
  it("renders every line of the source", () => {
    const all = renderedText(source);
    const title = parseLegalDocument(source).title;

    const missing = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== "---" && !line.startsWith("**Last updated:"))
      // The title is rendered by the page header rather than the body.
      .filter((line) => line !== `# ${title}`)
      .map((line) => line.replace(/^#{1,3}\s+/, "").replace(/^[-*]\s+/, ""))
      .filter((text) => !all.includes(text));

    expect(missing).toEqual([]);
  });

  it("lifts the title and the date out of the body", () => {
    const document = parseLegalDocument(source);

    expect(document.title).toMatch(/^CoSetup /);
    expect(document.lastUpdated).toBe("28 August 2026");
    // Otherwise the page header and the first paragraph would say it twice.
    expect(renderedText(source)).not.toContain("Last updated:");
  });

  it("numbers every clause, so a contents list can cite them", () => {
    const sections = parseLegalDocument(source).parts.flatMap((part) => part.sections);

    expect(sections.length).toBeGreaterThan(40);
    expect(sections.filter((section) => !section.number)).toEqual([]);
  });

  /**
   * Anchors are built from the number *and* the heading, so
   * `#clause-24-lawful-bases` cannot be repointed by a later clause being
   * inserted above it. Duplicates would mean two clauses sharing a link, which a
   * citation cannot survive.
   *
   * The `clause-` prefix is asserted here rather than left to the eye: an id
   * starting with a digit is legal HTML but is not a valid CSS identifier, so
   * `querySelector` throws on it and `:target` cannot address it.
   */
  it("gives every clause a unique anchor", () => {
    const ids = parseLegalDocument(source)
      .parts.flatMap((part) => part.sections)
      .map((section) => section.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^clause-\d+-[a-z0-9-]+$/.test(id))).toBe(true);
  });
});

describe("structure", () => {
  it("keeps the terms' closing summary at the end, not in the preamble", () => {
    const document = parseLegalDocument(TERMS_OF_SERVICE);
    const last = document.parts.at(-1);

    expect(last?.heading).toBe("Summary");
    // Prose under a part with no clause of its own — the case that broke.
    expect(last?.blocks.length).toBeGreaterThan(0);
    expect(JSON.stringify(document.preamble)).not.toContain("CoSetup exists to make");
  });

  it("splits a clause number from its heading", () => {
    const sections = parseLegalDocument(PRIVACY_POLICY).parts.flatMap((part) => part.sections);
    const lawfulBases = sections.find((section) => section.heading === "Lawful bases");

    expect(lawfulBases?.number).toBe("24");
    expect(lawfulBases?.id).toBe("clause-24-lawful-bases");
  });

  it("keeps `###` subheadings inside their clause", () => {
    const sections = parseLegalDocument(PRIVACY_POLICY).parts.flatMap((part) => part.sections);
    const lawfulBases = sections.find((section) => section.heading === "Lawful bases");

    expect(
      lawfulBases?.blocks.filter((block) => block.kind === "subheading").map((b) => b.lines[0]),
    ).toEqual(["Contract", "Legal obligation", "Legitimate interests", "Consent"]);
  });

  it("keeps a bullet list together as one block", () => {
    const sections = parseLegalDocument(PRIVACY_POLICY).parts.flatMap((part) => part.sections);
    const account = sections.find((section) => section.number === "2");
    const list = account?.blocks.find((block) => block.kind === "list");

    expect(list?.lines).toContain("your name;");
    expect(list?.lines.length).toBeGreaterThan(5);
  });
});
