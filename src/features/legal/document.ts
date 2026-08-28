/**
 * Turning a legal document's Markdown into something a page can lay out.
 *
 * ## Why parse rather than hand-transcribe
 *
 * The obvious alternative — retyping the clauses into a TSX array, as the
 * placeholder pages did — is how a comma moves in a contract. These documents
 * are 70KB of text across 128 numbered clauses; any transcription is a chance to
 * silently alter a term, and nothing in the test suite would catch it. Parsing
 * the supplied text means the page renders what was written or it renders
 * nothing.
 *
 * ## A small parser rather than a Markdown library
 *
 * The same reasoning `features/requirements/components/markdown.tsx` gives about
 * itself, and it is stronger here: the two documents between them use headings,
 * paragraphs, bullet lists, horizontal rules and `**bold**`. That is five
 * constructs. A CommonMark parser plus a sanitiser is two dependencies with a
 * larger surface than the feature, and this builds React elements rather than
 * HTML, so there is nothing to sanitise.
 *
 * It is deliberately *not* an extension of that assistant renderer. That one has
 * no headings by design and is tuned for chat turns; this one is structural —
 * it has to know a clause from a part so the page can build a contents list.
 *
 * ## Unsupported syntax degrades to text
 *
 * A table or a link in a future revision renders as its own source characters:
 * visible, ugly, and obviously wrong to whoever pastes it in. That is the right
 * failure for a legal page — the alternative is silently dropping a clause.
 */

export interface LegalBlock {
  kind: "paragraph" | "list" | "subheading";
  /** One string for a paragraph or subheading; one per item for a list. */
  lines: string[];
}

export interface LegalSection {
  /** `"24"` from `## 24. Lawful bases`, or absent for an unnumbered section. */
  number?: string;
  heading: string;
  /** Slug for the anchor and the contents link. */
  id: string;
  blocks: LegalBlock[];
}

/** A `# PART C — …` grouping, or the untitled run of sections before the first one. */
export interface LegalPart {
  heading?: string;
  id?: string;
  /**
   * Prose sitting under the part heading before any clause opens.
   *
   * Not hypothetical: the terms end with `# Summary`, seven paragraphs and no
   * `##` beneath it. Without somewhere to put them they fell through to the
   * preamble and the closing summary rendered at the top of the document — the
   * kind of silent reordering that makes parsing a legal text worth checking
   * rather than trusting.
   */
  blocks: LegalBlock[];
  sections: LegalSection[];
}

export interface LegalDocument {
  title: string;
  /** As printed in the document, e.g. `"28 August 2026"`. Empty if it says nothing. */
  lastUpdated: string;
  /** Everything before the first heading — the preamble. */
  preamble: LegalBlock[];
  parts: LegalPart[];
}

const LAST_UPDATED = /^\*\*Last updated:\s*(.+?)\*\*$/;

export function parseLegalDocument(source: string): LegalDocument {
  const lines = source.split("\n");

  let title = "";
  let lastUpdated = "";
  const preamble: LegalBlock[] = [];
  const parts: LegalPart[] = [];

  /*
   * Blocks land wherever the cursor currently is, innermost first: the open
   * clause, else the open part, else the preamble.
   */
  let section: LegalSection | null = null;
  let part: LegalPart | null = null;

  let paragraph: string[] = [];
  let list: string[] = [];

  const target = () => section?.blocks ?? part?.blocks ?? preamble;

  const flush = () => {
    if (paragraph.length > 0) {
      // Joined with a space: a hard-wrapped paragraph is one paragraph, and
      // these documents wrap at sentence boundaries rather than at a column.
      target().push({ kind: "paragraph", lines: [paragraph.join(" ")] });
      paragraph = [];
    }
    if (list.length > 0) {
      target().push({ kind: "list", lines: list });
      list = [];
    }
  };

  const openPart = (heading?: string) => {
    flush();
    section = null;
    part = { ...(heading ? { heading, id: slug(heading) } : {}), blocks: [], sections: [] };
    parts.push(part);
  };

  for (const raw of lines) {
    const line = raw.trim();

    /*
     * `---` is dropped rather than rendered.
     *
     * The source puts one between every clause, where it is a plain-text reader's
     * only cue that a section ended. On the page each clause is a headed block in
     * its own right, so eighty horizontal rules would be eighty lines of noise
     * restating what the layout already says. No words are lost — a rule carries
     * none.
     */
    if (line === "---") {
      flush();
      continue;
    }

    if (line.startsWith("# ")) {
      const heading = line.slice(2).trim();

      // The first `# ` is the document's own title, not a part.
      if (!title) {
        flush();
        title = heading;
        continue;
      }

      openPart(heading);
      continue;
    }

    if (line.startsWith("## ")) {
      flush();
      const heading = line.slice(3).trim();
      // `## 24. Lawful bases` → number `24`, heading `Lawful bases`. The number
      // is separated so the contents list can set it in its own column and the
      // heading can wrap without dragging it along.
      const numbered = /^(\d+)\.\s+(.*)$/.exec(heading);

      // A document that opens with `##` before any `#` still needs somewhere to
      // put it, so the first section implies an untitled part.
      if (!part) openPart();

      section = {
        ...(numbered ? { number: numbered[1]! } : {}),
        heading: numbered ? numbered[2]! : heading,
        // `clause-` prefixed — see `slug`.
        id: `clause-${slug(heading)}`,
        blocks: [],
      };
      part!.sections.push(section);
      continue;
    }

    if (line.startsWith("### ")) {
      flush();
      target().push({ kind: "subheading", lines: [line.slice(4).trim()] });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (paragraph.length > 0) flush();
      list.push(bullet[1]!);
      continue;
    }

    if (line === "") {
      flush();
      continue;
    }

    // The date line is metadata the page header renders, so it is lifted out
    // rather than left to appear twice.
    const dated = LAST_UPDATED.exec(line);
    if (dated && !lastUpdated) {
      flush();
      lastUpdated = dated[1]!.trim();
      continue;
    }

    if (list.length > 0) flush();
    paragraph.push(line);
  }

  flush();

  return { title, lastUpdated, preamble, parts };
}

/**
 * A stable anchor.
 *
 * Built from the heading **including its number**, so `#clause-24-lawful-bases`
 * survives a later clause being inserted above it — which renumbering would
 * otherwise silently repoint. A legal citation that moves is worse than one that
 * looks odd.
 *
 * Clauses carry a `clause-` prefix at the call site, and that is not cosmetic:
 * an id beginning with a digit is valid HTML and works as a fragment link, but
 * it is **not** a valid CSS identifier — `document.querySelector("#24-lawful-bases")`
 * throws, and a `:target` rule would need escaping. The prefix keeps the id
 * usable from every direction, and reads better in a citation besides.
 */
function slug(heading: string): string {
  return (
    heading
      .toLowerCase()
      // Anything that is not a letter, a digit or a space becomes a gap, which
      // takes care of the em dashes in `PART C — ORDERS, PRICING AND PAYMENT`.
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, "-") || "section"
  );
}
