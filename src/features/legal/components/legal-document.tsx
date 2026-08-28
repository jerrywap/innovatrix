import type { ReactNode } from "react";
import type { LegalBlock, LegalDocument, LegalSection } from "../document";

/**
 * A long legal document, laid out to be navigated rather than scrolled.
 *
 * ## Why a contents list is not decoration here
 *
 * The terms run to eighty-two clauses and the privacy policy to forty-eight.
 * Somebody arriving at either almost never wants to read it from the top — they
 * want refunds, or retention, or what happens to their code — and a single
 * column of prose makes finding that a scroll and a guess. The contents list is
 * the page's main control, which is why it is sticky on a wide screen and the
 * first thing under the header on a narrow one.
 *
 * ## Every clause is addressable
 *
 * `id` on each heading, and the number rendered beside it, so support can send
 * "see clause 23" as a link that lands on it. `parseLegalDocument` builds those
 * anchors from the number *and* the words, so inserting a clause cannot silently
 * repoint an existing citation.
 *
 * ## Nothing here rewrites the text
 *
 * The component chooses type sizes and spacing. Every string it renders comes
 * from the source document unchanged — no truncation, no summarising, no
 * "read more". A legal page that hides half its sentences behind an accordion is
 * a page that can be argued not to have been presented.
 */
export function LegalDocumentView({ document }: { document: LegalDocument }) {
  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
      <Contents document={document} />

      <div className="min-w-0">
        {document.preamble.length > 0 && (
          <div className="border-border flex flex-col gap-3 border-b pb-8">
            {document.preamble.map((block, index) => (
              <Block key={index} block={block} lead />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-14 pt-10">
          {document.parts.map((part, index) => (
            <section key={part.id ?? index} className="flex flex-col gap-8">
              {part.heading && (
                <h2
                  id={part.id}
                  className="text-subtle border-border scroll-mt-24 border-b pb-3 font-mono text-[10.5px] tracking-[0.2em] uppercase"
                >
                  {part.heading}
                </h2>
              )}

              {part.blocks.length > 0 && (
                <div className="flex flex-col gap-3">
                  {part.blocks.map((block, blockIndex) => (
                    <Block key={blockIndex} block={block} />
                  ))}
                </div>
              )}

              {part.sections.map((section) => (
                <Clause key={section.id} section={section} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function Clause({ section }: { section: LegalSection }) {
  return (
    <section id={section.id} className="scroll-mt-24">
      <h3 className="font-display flex gap-3 text-[17px] leading-snug tracking-[-0.02em]">
        {section.number && (
          // `aria-hidden`: the number is in the heading's own anchor and in the
          // contents list, and a screen reader reading "twenty-four dot" before
          // every heading is noise rather than navigation.
          <span aria-hidden className="text-subtle mt-0.5 font-mono text-[12px] tabular-nums">
            {section.number}
          </span>
        )}
        {section.heading}
      </h3>

      <div className="mt-3 flex flex-col gap-3 sm:pl-[calc(1.5rem+0.75rem)]">
        {section.blocks.map((block, index) => (
          <Block key={index} block={block} />
        ))}
      </div>
    </section>
  );
}

function Block({ block, lead = false }: { block: LegalBlock; lead?: boolean }) {
  if (block.kind === "subheading") {
    return (
      <h4 className="mt-3 text-[13.5px] font-semibold tracking-[-0.01em]">
        {inline(block.lines[0] ?? "")}
      </h4>
    );
  }

  if (block.kind === "list") {
    return (
      <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed">
        {block.lines.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>
    );
  }

  return (
    <p
      className={
        lead
          ? "text-foreground max-w-[74ch] text-[15px] leading-relaxed"
          : "text-muted-foreground max-w-[74ch] text-[14px] leading-relaxed"
      }
    >
      {inline(block.lines[0] ?? "")}
    </p>
  );
}

/**
 * The contents list.
 *
 * ## A capped, scrollable index rather than a `<details>`
 *
 * It was a disclosure, so a phone did not have to scroll past eighty-two links
 * to reach clause 1. Chrome paints `::-webkit-details-marker` on a `<summary>`
 * regardless of `list-style: none` *or* `display: block` — the triangle sat on
 * the first letter and "CONTENTS" rendered as ",ONTENTS". A `<div>` carrying the
 * identical classes rendered it correctly, which is how the marker was
 * identified rather than guessed at.
 *
 * Capping the height and letting the list scroll inside itself solves the
 * original problem better anyway: the index is *visible* on a phone instead of
 * being a control somebody has to know to tap, and it costs no vertical space
 * either way.
 */
function Contents({ document }: { document: LegalDocument }) {
  return (
    <nav
      aria-label={`${document.title} contents`}
      /*
        `lg:pl-1` is load-bearing, not spacing.

        `overflow-y-auto` makes this a scroll container, which clips anything
        outside its padding box — and JetBrains Mono at 10px with `tracking-[0.2em]`
        paints the first glyph's ink a hair left of the content origin. With
        `lg:p-0` that hair was cut off and "CONTENTS" rendered as ",ONTENTS".
        Four pixels of left padding is the whole fix; the mobile card never showed
        it because `p-5` already provided the room.
      */
      className="border-border bg-surface-muted/40 h-fit max-h-[18rem] overflow-y-auto rounded-[22px] border p-5 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:border-0 lg:bg-transparent lg:py-0 lg:pr-3 lg:pl-1"
    >
      <h2 className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">Contents</h2>

      <div className="mt-4 flex flex-col gap-5">
        {document.parts.map((part, index) => (
          <div key={part.id ?? index} className="flex flex-col gap-1.5">
            {part.heading && (
              <a
                href={`#${part.id}`}
                className="text-subtle hover:text-foreground text-[10px] font-medium tracking-[0.14em] uppercase transition"
              >
                {part.heading}
              </a>
            )}

            <ul className="flex flex-col gap-1">
              {part.sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="text-muted-foreground hover:text-foreground flex gap-2 text-[12.5px] leading-snug transition"
                  >
                    <span
                      aria-hidden
                      className="text-subtle font-mono text-[11px] tabular-nums"
                    >
                      {section.number}
                    </span>
                    {section.heading}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * `**bold**`, and nothing else.
 *
 * Both documents use exactly one inline construct. Supporting italics and code
 * as well would be three regexes maintained for two of them, and anything
 * unsupported renders as its own characters — visible to whoever pastes a
 * revision, which is the failure this should have.
 */
const BOLD = /\*\*([^*]+)\*\*/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(BOLD)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      <strong key={match.index} className="text-foreground font-medium">
        {match[1]}
      </strong>,
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}
