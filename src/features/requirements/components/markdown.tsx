import type { ReactNode } from "react";

/**
 * The small subset of Markdown a model actually emits in conversation.
 *
 * ## Safe because it cannot produce HTML, not because it sanitises it
 *
 * This builds React elements from matched patterns. There is no
 * `dangerouslySetInnerHTML`, no HTML parsing, and no passthrough — so a model
 * that emits `<img onerror=…>` renders those characters as text, which is both
 * the safe outcome and the honest one. Sanitising a rendered HTML string is the
 * other approach and it is only as good as the sanitiser's blocklist.
 *
 * ## Deliberately not a Markdown library
 *
 * Assistant turns use bold, the occasional list, and inline code. Pulling in a
 * full CommonMark parser plus a sanitiser to render three constructs would add
 * two dependencies whose combined surface is larger than the feature.
 *
 * Anything unsupported degrades to plain text with the syntax visible, which is
 * ugly and readable — the right failure for prose a customer is reading.
 */

export function Markdown({ children }: { children: string }) {
  return <div className="flex flex-col gap-2">{blocks(children)}</div>;
}

function blocks(source: string): ReactNode[] {
  const lines = source.split("\n");
  const out: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(
      <p key={`p${out.length}`} className="text-[14px] leading-relaxed">
        {inline(paragraph.join(" "))}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag
        key={`l${out.length}`}
        className={
          list.ordered
            ? "flex list-decimal flex-col gap-1 pl-5 text-[14px]"
            : "flex list-disc flex-col gap-1 pl-5 text-[14px]"
        }
      >
        {list.items.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (bullet) {
      flushParagraph();
      // A bullet after a numbered list starts a new list rather than joining it.
      if (list?.ordered) flushList();
      list ??= { ordered: false, items: [] };
      list.items.push(bullet[1]!);
      continue;
    }

    if (numbered) {
      flushParagraph();
      if (list && !list.ordered) flushList();
      list ??= { ordered: true, items: [] };
      list.items.push(numbered[1]!);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();

  return out;
}

/**
 * `**bold**`, `*italic*`, `` `code` `` — tokenised in one pass.
 *
 * One regex with alternates rather than three sequential passes: running them
 * in sequence lets a replacement from an earlier pass be re-matched by a later
 * one, which is how `` `**not bold**` `` ends up bold inside a code span.
 */
const INLINE = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));

    const token = match[0];
    if (token.startsWith("**")) {
      out.push(<strong key={at}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(
        <code key={at} className="bg-surface-muted rounded px-1 py-0.5 font-mono text-[12.5px]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={at}>{token.slice(1, -1)}</em>);
    }

    last = at + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}
