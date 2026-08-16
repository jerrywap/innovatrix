import { describe, expect, it } from "vitest";
import {
  fromPlainText,
  isEmptyDocument,
  plainText,
  richTextDocumentSchema,
  type RichTextDocument,
} from "./schema";

const doc = (content: unknown) => ({ type: "doc", content });
const para = (text: string, marks?: unknown) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});

describe("richTextDocumentSchema — the security boundary", () => {
  it("accepts the shapes the editor produces", () => {
    const input = doc([
      para("A CRM for property managers."),
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Features" }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [para("Role-based access")] },
          { type: "listItem", content: [para("Reporting")] },
        ],
      },
    ]);
    expect(richTextDocumentSchema.safeParse(input).success).toBe(true);
  });

  /* ────────────────────────────────────── links */

  it("accepts http, https and mailto links", () => {
    for (const href of ["https://example.com", "http://example.com", "mailto:a@b.com"]) {
      const input = doc([para("docs", [{ type: "link", attrs: { href } }])]);
      expect(richTextDocumentSchema.safeParse(input).success, href).toBe(true);
    }
  });

  /**
   * The reason this schema exists. A link mark is the one place a user supplies
   * a URL, and each of these is script execution or a bypass dressed as a link.
   */
  it.each([
    ["javascript", "javascript:alert(1)"],
    ["javascript, mixed case", "JavaScript:alert(1)"],
    ["data url", "data:text/html,<script>alert(1)</script>"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["file", "file:///etc/passwd"],
    ["protocol-relative", "//evil.example"],
    ["bare path", "/dashboard"],
  ])("rejects a %s href", (_label, href) => {
    const input = doc([para("click me", [{ type: "link", attrs: { href } }])]);
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false);
  });

  /* ────────────────────────────────────── unknown content */

  it("rejects a node type the renderer does not know", () => {
    // The renderer ignores unknown nodes, but nothing unrecognised should ever
    // reach storage in the first place.
    const input = doc([{ type: "image", attrs: { src: "https://evil.example/x.png" } }]);
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a mark type that isn't offered", () => {
    const input = doc([para("x", [{ type: "textStyle", attrs: { color: "red" } }])]);
    expect(richTextDocumentSchema.safeParse(input).success).toBe(false);
  });

  it("rejects h1 — the page owns that level", () => {
    const bad = doc([{ type: "heading", attrs: { level: 1 }, content: [] }]);
    expect(richTextDocumentSchema.safeParse(bad).success).toBe(false);

    const good = doc([{ type: "heading", attrs: { level: 2 }, content: [] }]);
    expect(richTextDocumentSchema.safeParse(good).success).toBe(true);
  });

  /* ────────────────────────────────────── bounds */

  it("rejects a tree nested deep enough to blow the renderer's stack", () => {
    let node: unknown = { type: "paragraph", content: [{ type: "text", text: "deep" }] };
    for (let i = 0; i < 20; i += 1) {
      node = { type: "bulletList", content: [{ type: "listItem", content: [node] }] };
    }
    const result = richTextDocumentSchema.safeParse(doc([node]));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/nested too deeply/);
  });

  /**
   * A regression guard for the schema's shape, not a performance test.
   *
   * With a plain `z.union` this input does not finish — Zod tries every member
   * at every level, so cost is exponential in depth, and anyone able to POST a
   * description could hang a server thread. `discriminatedUnion` makes it
   * linear. The bound is deliberately generous: what is being asserted is
   * "terminates", not "is fast".
   */
  it("rejects deep nesting quickly, rather than not terminating", () => {
    let node: unknown = { type: "paragraph", content: [{ type: "text", text: "deep" }] };
    for (let i = 0; i < 25; i += 1) {
      node = { type: "bulletList", content: [{ type: "listItem", content: [node] }] };
    }

    const started = Date.now();
    expect(richTextDocumentSchema.safeParse(doc([node])).success).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("rejects a document with an absurd number of nodes", () => {
    const many = Array.from({ length: 400 }, () => ({
      type: "bulletList",
      content: Array.from({ length: 6 }, () => ({
        type: "listItem",
        content: [para("x")],
      })),
    }));
    const result = richTextDocumentSchema.safeParse(doc(many));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/too long/);
  });

  it("accepts an empty document", () => {
    expect(richTextDocumentSchema.safeParse(doc([])).success).toBe(true);
  });
});

describe("plainText", () => {
  it("extracts prose for metadata and the text index", () => {
    const d = richTextDocumentSchema.parse(
      doc([
        para("Atlas CRM."),
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para("Roles")] }],
        },
      ]),
    ) as RichTextDocument;

    expect(plainText(d)).toBe("Atlas CRM. Roles");
  });

  it("separates blocks so adjacent words do not fuse", () => {
    const d = richTextDocumentSchema.parse(doc([para("Features"), para("Reporting")]));
    // Without block separation this would be "FeaturesReporting", which the
    // text index would score as one nonsense token.
    expect(plainText(d as RichTextDocument)).toBe("Features Reporting");
  });

  it("returns an empty string for nothing", () => {
    expect(plainText(null)).toBe("");
    expect(plainText({ type: "doc", content: [] })).toBe("");
  });
});

describe("isEmptyDocument", () => {
  it("treats a document of blank paragraphs as empty", () => {
    // The editor leaves these behind when someone clears the field.
    expect(isEmptyDocument({ type: "doc", content: [] })).toBe(true);
    expect(isEmptyDocument(fromPlainText("   "))).toBe(true);
    expect(isEmptyDocument(null)).toBe(true);
  });

  it("is false once there is real prose", () => {
    expect(isEmptyDocument(fromPlainText("Hello"))).toBe(false);
  });
});

describe("fromPlainText", () => {
  it("splits blank-line-separated blocks into paragraphs", () => {
    const d = fromPlainText("First para.\n\nSecond para.");
    expect(d.content).toHaveLength(2);
    expect(plainText(d)).toBe("First para. Second para.");
  });

  it("produces documents this schema accepts — the migration path", () => {
    // Existing `description` strings become documents through this function, so
    // its output must validate or the migration silently drops content.
    const d = fromPlainText("Line one.\n\nLine two with a - dash.");
    expect(richTextDocumentSchema.safeParse(d).success).toBe(true);
  });
});

describe("stored values that are not documents", () => {
  /**
   * `Product.description` is a Mongoose `Mixed` path, so the type says
   * `RichTextDocument` and the value is whatever is in the database — including
   * a plain string written before rich text existed. These run on the publish
   * path via readiness, so throwing here would break publishing outright.
   */
  const notDocuments = [
    ["a legacy plain string", "A CRM for property teams."],
    ["a number", 42],
    ["an array", [{ type: "paragraph" }]],
    ["an object with no content", { type: "doc" }],
    ["content that is not an array", { type: "doc", content: "text" }],
  ] as const;

  it.each(notDocuments)("treats %s as empty rather than throwing", (_label, value) => {
    const stored = value as unknown as RichTextDocument;
    expect(() => isEmptyDocument(stored)).not.toThrow();
    expect(isEmptyDocument(stored)).toBe(true);
    expect(plainText(stored)).toBe("");
  });
});
