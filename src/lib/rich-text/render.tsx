import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { RichTextDocument, RichTextMark, RichTextNode } from "./schema";

/**
 * Render a validated node tree as React elements.
 *
 * A **Server Component** and a plain `switch` — no `dangerouslySetInnerHTML`,
 * no HTML string, and crucially **no Tiptap**. The editor is a client-side
 * dependency of the admin area only; a customer loading a product page should
 * not download a rich-text editor to read a paragraph.
 *
 * The security guarantee lives in `schema.ts`, which decides what may be
 * stored. This file is the second line: an unrecognised node type renders
 * nothing rather than being trusted, so even a document written before a schema
 * change cannot surprise a reader.
 *
 * ## Links
 *
 * `rel="noopener noreferrer"` and `target="_blank"` are set **here**, from the
 * node type, not read from the stored document. A stored `target` attribute is
 * ignored — otherwise a document could opt itself out of `noopener`, which is
 * the point of storing structure rather than markup.
 */

export function RichTextRenderer({
  doc,
  className,
}: {
  doc: RichTextDocument | null | undefined;
  className?: string;
}) {
  if (!doc || doc.content.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-4 text-[14.5px] leading-relaxed", className)}>
      <Nodes nodes={doc.content} />
    </div>
  );
}

function Nodes({ nodes }: { nodes: readonly RichTextNode[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Node key={index} node={node} />
      ))}
    </>
  );
}

function Node({ node }: { node: RichTextNode }) {
  switch (node.type) {
    case "text":
      return <Marked text={node.text} marks={node.marks} />;

    case "hardBreak":
      return <br />;

    case "horizontalRule":
      return <hr className="border-border my-2" />;

    case "paragraph":
      // An empty paragraph is the editor's blank line. Rendering `<p/>` gives
      // it no height, so it would silently vanish; a non-breaking space keeps
      // the spacing the author saw while typing.
      return <p>{node.content?.length ? <Nodes nodes={node.content} /> : <>&nbsp;</>}</p>;

    case "heading":
      // h2/h3 only — h1 belongs to the page title. See the schema note.
      return node.attrs.level === 2 ? (
        <h2 className="font-display mt-2 text-[19px] tracking-[-0.02em]">
          <Nodes nodes={node.content ?? []} />
        </h2>
      ) : (
        <h3 className="font-display mt-1 text-[16px] tracking-[-0.02em]">
          <Nodes nodes={node.content ?? []} />
        </h3>
      );

    case "blockquote":
      return (
        <blockquote className="border-border text-muted-foreground border-l-2 pl-4">
          <Nodes nodes={node.content ?? []} />
        </blockquote>
      );

    case "codeBlock":
      return (
        <pre className="border-border bg-surface-muted overflow-x-auto rounded-xl border p-3.5 font-mono text-[13px]">
          <code>
            <Nodes nodes={node.content ?? []} />
          </code>
        </pre>
      );

    case "bulletList":
      return (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <Nodes nodes={node.content ?? []} />
        </ul>
      );

    case "orderedList":
      return (
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <Nodes nodes={node.content ?? []} />
        </ol>
      );

    case "listItem":
      return (
        <li>
          <Nodes nodes={node.content ?? []} />
        </li>
      );

    default:
      // Unreachable while the schema and this switch agree — and deliberately
      // silent rather than throwing if they ever don't. A product page that
      // 500s because someone added a node type is worse than one missing a
      // paragraph.
      return null;
  }
}

/**
 * Apply marks by nesting elements, innermost first.
 *
 * The order matters only for `link`, which must be the outermost element so
 * the whole styled run is clickable.
 */
function Marked({ text, marks }: { text: string; marks?: readonly RichTextMark[] }) {
  if (!marks || marks.length === 0) return <>{text}</>;

  let element: React.ReactNode = text;

  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        element = <strong className="font-semibold">{element}</strong>;
        break;
      case "italic":
        element = <em>{element}</em>;
        break;
      case "strike":
        element = <s>{element}</s>;
        break;
      case "underline":
        element = <u>{element}</u>;
        break;
      case "code":
        element = (
          <code className="bg-surface-muted rounded px-1 py-0.5 font-mono text-[13px]">
            {element}
          </code>
        );
        break;
      case "link":
        element = (
          <a
            href={mark.attrs.href}
            // Set here, from the mark type — never read from the document.
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-signal-text underline underline-offset-2"
          >
            {element}
          </a>
        );
        break;
    }
  }

  return <Fragment>{element}</Fragment>;
}
