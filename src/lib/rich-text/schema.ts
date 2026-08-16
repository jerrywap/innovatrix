import { z } from "zod";

/**
 * The document format for product descriptions — a validated node tree, never
 * an HTML string.
 *
 * ## Why a tree and not HTML
 *
 * The usual rich-text design stores the editor's HTML output and renders it
 * with `dangerouslySetInnerHTML` behind a sanitiser. That is stored XSS waiting
 * for one dependency bump, one config change, or one `svg` allowance — and the
 * payload fires for every visitor from then on.
 *
 * Here the editor (Tiptap, which is ProseMirror underneath) emits JSON, **this
 * schema is what decides whether it may be stored**, and the renderer is a
 * switch over node types that emits React elements. There is no string of
 * markup anywhere in the path, so there is nothing for a sanitiser to get
 * wrong.
 *
 * ## This file is the security boundary, not the renderer
 *
 * The renderer ignores node types it does not know, which is good defence but
 * is not the guarantee. The guarantee is that nothing unrecognised is ever
 * *written*. Anything the editor can produce that is not described below is
 * rejected at the action boundary, with the same `ValidationError` machinery as
 * any other bad input.
 *
 * Three specific things it stops:
 *
 * 1. **`javascript:` and `data:` hrefs.** A link mark is the one place a user
 *    supplies a URL, and `javascript:alert(1)` in an `href` is script execution
 *    on click. Only http, https and mailto survive.
 * 2. **Unbounded nesting.** A hand-crafted body can nest lists a thousand deep
 *    and blow the stack in the renderer. Depth is capped.
 * 3. **Unbounded size.** A description is prose, not a payload.
 */

/** Deep enough for a list inside a list inside a quote; shallow enough to be safe. */
const MAX_DEPTH = 6;
/** Roughly 60k of prose — far more than any real product description. */
const MAX_NODES = 2_000;

/* ────────────────────────────────────────────── marks */

/**
 * Only schemes that cannot execute.
 *
 * `data:` is excluded deliberately even though it looks inert:
 * `data:text/html,<script>…</script>` is not.
 */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

const linkMarkSchema = z.object({
  type: z.literal("link"),
  attrs: z.object({
    href: z
      .string()
      .trim()
      .max(2048)
      .refine((v) => SAFE_LINK.test(v), {
        message: "Links must start with http://, https:// or mailto:",
      }),
    // Never accepted from input — the renderer sets rel itself, so a stored
    // document cannot opt out of noopener.
    target: z.string().optional(),
  }),
});

/**
 * Discriminated on `type`, not a plain union.
 *
 * A plain `z.union` tries every member until one matches. For a *recursive*
 * schema that is exponential in depth: at ten node types and twenty levels of
 * nesting, validating one hand-crafted document never returns. That is a
 * denial of service reachable by anyone who can POST a description — and the
 * depth cap below cannot save it, because the cap runs after the parse that
 * hangs.
 *
 * `discriminatedUnion` reads `type` and dispatches to exactly one branch, so
 * cost is linear in the number of nodes regardless of shape.
 */
const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("underline") }),
  linkMarkSchema,
]);

export type RichTextMark = z.infer<typeof markSchema>;

/* ────────────────────────────────────────────── nodes */

const textNodeSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(10_000),
  marks: z.array(markSchema).max(8).optional(),
});

/**
 * Block and inline nodes.
 *
 * Recursive, so Zod needs an explicit type annotation and a getter. The node
 * list is deliberately short: these are the things the toolbar offers and the
 * renderer knows how to draw. Adding one means adding it in three places —
 * here, the renderer, and the editor's extension list — which is the right
 * amount of friction for expanding what a stored document may contain.
 */
export type RichTextNode =
  | { type: "text"; text: string; marks?: RichTextMark[] }
  | { type: "hardBreak" }
  | { type: "horizontalRule" }
  | { type: "paragraph"; content?: RichTextNode[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: RichTextNode[] }
  | { type: "blockquote"; content?: RichTextNode[] }
  | { type: "codeBlock"; content?: RichTextNode[] }
  | { type: "bulletList"; content?: RichTextNode[] }
  | { type: "orderedList"; content?: RichTextNode[] }
  | { type: "listItem"; content?: RichTextNode[] };

/** Blocks that are just a container for other nodes. */
const CONTAINER_TYPES = [
  "paragraph",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "listItem",
] as const;

const nodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  // Discriminated for the same reason as marks — see the note above.
  z.discriminatedUnion("type", [
    textNodeSchema,
    z.object({ type: z.literal("hardBreak") }),
    z.object({ type: z.literal("horizontalRule") }),
    z.object({
      type: z.literal("heading"),
      // h1 is the page title. A description that could emit its own h1 would
      // break the document outline on every product page.
      attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
      content: z.array(nodeSchema).optional(),
    }),
    ...CONTAINER_TYPES.map((type) =>
      z.object({ type: z.literal(type), content: z.array(nodeSchema).optional() }),
    ),
  ]),
);

export interface RichTextDocument {
  type: "doc";
  content: RichTextNode[];
}

/**
 * A whole description.
 *
 * The depth and size checks are `superRefine` rather than schema shape because
 * they are properties of the tree, not of any one node.
 */
export const richTextDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(nodeSchema).max(500).default([]),
  })
  .superRefine((doc, ctx) => {
    const { depth, nodes } = measure(doc.content);

    if (depth > MAX_DEPTH) {
      ctx.addIssue({
        code: "custom",
        message: `That content is nested too deeply (${depth} levels).`,
      });
    }
    if (nodes > MAX_NODES) {
      ctx.addIssue({ code: "custom", message: "That description is too long." });
    }
  });

function measure(nodes: readonly RichTextNode[], depth = 1): { depth: number; nodes: number } {
  let maxDepth = depth;
  let count = 0;

  for (const node of nodes) {
    count += 1;
    const children = "content" in node ? node.content : undefined;
    if (children && children.length > 0) {
      const inner = measure(children, depth + 1);
      maxDepth = Math.max(maxDepth, inner.depth);
      count += inner.nodes;
    }
  }

  return { depth: maxDepth, nodes: count };
}

/* ────────────────────────────────────────────── helpers */

export const EMPTY_DOCUMENT: RichTextDocument = { type: "doc", content: [] };

/**
 * Is there anything a reader would see? An empty paragraph is not content.
 *
 * Structurally defensive, because `Product.description` is a Mongoose `Mixed`
 * path: the compiler says `RichTextDocument`, but what actually comes back is
 * whatever is stored — a plain string from before rich text, or a half-written
 * document. Those reach here through readiness, which runs on the publish path,
 * so a `TypeError` on `.content.length` would take out publishing rather than
 * degrading. Treating anything unrecognisable as empty puts a bad document in
 * front of a "write the full description" gap instead.
 */
export function isEmptyDocument(doc: RichTextDocument | null | undefined): boolean {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.content)) return true;
  if (doc.content.length === 0) return true;
  return plainText(doc).trim().length === 0;
}

/**
 * The document as plain text — for `<meta name="description">`, for the text
 * index, and for the search excerpt.
 *
 * Not for rendering. Rendering goes through the renderer, which is what knows
 * about structure.
 */
export function plainText(doc: RichTextDocument | null | undefined): string {
  // Same reasoning as `isEmptyDocument`: the input can be a stored `Mixed`
  // value rather than a parsed document.
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.content)) return "";

  const parts: string[] = [];
  const walk = (nodes: readonly RichTextNode[]) => {
    for (const node of nodes) {
      if (node.type === "text") parts.push(node.text);
      else if (node.type === "hardBreak") parts.push(" ");
      const children = "content" in node ? node.content : undefined;
      if (children) {
        walk(children);
        // Blocks are separate sentences to a reader; without this "Features"
        // and "Reporting" would run together as "FeaturesReporting".
        parts.push(" ");
      }
    }
  };

  walk(doc.content);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/**
 * Wrap plain text as a document — for migrating the existing `description`
 * strings and for the seed.
 */
export function fromPlainText(text: string | null | undefined): RichTextDocument {
  if (!text?.trim()) return EMPTY_DOCUMENT;

  return {
    type: "doc",
    content: text
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => ({
        type: "paragraph" as const,
        content: [{ type: "text" as const, text: block }],
      })),
  };
}
