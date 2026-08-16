"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EMPTY_DOCUMENT, type RichTextDocument } from "@/lib/rich-text/schema";

/**
 * The product description editor.
 *
 * Emits a **ProseMirror node tree**, never HTML, and posts it as JSON in a
 * hidden field. The server validates that tree against
 * `richTextDocumentSchema` before storing it — that validation, not this
 * component, is the security boundary. Everything here is convenience.
 *
 * ## The extension list is deliberately short
 *
 * It matches `schema.ts` exactly. An extension enabled here but absent there
 * produces content the server rejects on save, which reads to the author as the
 * editor being broken. Adding a node means changing three files together: the
 * schema, the renderer, and this list. That friction is correct — each one
 * widens what a stored document may contain.
 *
 * Specifically disabled:
 * - **h1** — the page owns that level; a description that emits its own would
 *   break the document outline on every product page.
 * - **images** — media has its own step, with storage keys and alt text.
 *   An arbitrary `<img src>` in prose is an unreviewed external request.
 *
 * ## SSR
 *
 * `immediatelyRender: false` is required under Next.js. Tiptap renders to the
 * DOM, so letting it run during the server pass produces markup React then
 * disagrees with at hydration.
 */

export function RichTextEditor({
  name,
  defaultValue,
  placeholder = "Describe what this product does, for someone deciding whether to buy it.",
  disabled,
}: {
  /** Hidden field name — the JSON document is posted under this. */
  name: string;
  defaultValue?: RichTextDocument | undefined;
  placeholder?: string;
  disabled?: boolean;
}) {
  const initial = defaultValue ?? EMPTY_DOCUMENT;
  const [value, setValue] = useState(() => JSON.stringify(initial));

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Media is its own step. See the note above.
        horizontalRule: false,
        link: {
          openOnClick: false,
          // Mirrors the schema's allowlist so the editor refuses what the
          // server would reject, rather than letting someone type it and
          // discover the problem on save.
          protocols: ["http", "https", "mailto"],
          HTMLAttributes: { rel: "noopener noreferrer nofollow" },
        },
      }),
    ],
    content: initial,
    onUpdate: ({ editor: instance }) => setValue(JSON.stringify(instance.getJSON())),
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[220px] w-full px-3.5 py-3 text-[14.5px] leading-relaxed outline-none",
          "[&_h2]:font-display [&_h2]:mt-3 [&_h2]:text-[19px] [&_h2]:tracking-[-0.02em]",
          "[&_h3]:font-display [&_h3]:mt-2 [&_h3]:text-[16px]",
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_blockquote]:border-border [&_blockquote]:border-l-2 [&_blockquote]:pl-4",
          "[&_p]:mb-2 [&_p:last-child]:mb-0",
        ),
        "aria-label": "Product description",
      },
    },
  });

  // Keep the editable state in step if the form is disabled mid-submit.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "border-border bg-surface focus-within:ring-ring overflow-hidden rounded-xl border transition focus-within:ring-2",
          disabled && "opacity-60",
        )}
      >
        <Toolbar editor={editor} disabled={disabled} />
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          // Before hydration. Matching the editor's min-height stops the form
          // jumping when it mounts.
          <div className="text-subtle min-h-[220px] px-3.5 py-3 text-[14.5px]">
            {placeholder}
          </div>
        )}
      </div>

      {/* What actually gets posted. The server re-validates it regardless. */}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

function Toolbar({
  editor,
  disabled,
}: {
  /**
   * `Editor | null`, spelled out rather than `ReturnType<typeof useEditor>`.
   * `useEditor` is overloaded — only the `immediatelyRender: false` overload
   * returns a nullable editor, and `ReturnType` resolves to the *last*
   * overload, which does not. It types as non-null and then is null at runtime
   * until hydration.
   */
  editor: Editor | null;
  disabled?: boolean;
}) {
  if (!editor) return <div className="border-border bg-surface-muted h-10 border-b" />;

  const buttons = [
    {
      icon: Bold,
      label: "Bold",
      isActive: () => editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      icon: Italic,
      label: "Italic",
      isActive: () => editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      icon: Strikethrough,
      label: "Strikethrough",
      isActive: () => editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      icon: Code,
      label: "Inline code",
      isActive: () => editor.isActive("code"),
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      icon: Heading2,
      label: "Heading",
      isActive: () => editor.isActive("heading", { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      icon: Heading3,
      label: "Subheading",
      isActive: () => editor.isActive("heading", { level: 3 }),
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      icon: List,
      label: "Bulleted list",
      isActive: () => editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      label: "Numbered list",
      isActive: () => editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      icon: Quote,
      label: "Quote",
      isActive: () => editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ];

  return (
    <div className="border-border bg-surface-muted flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1.5">
      {buttons.map(({ icon: Icon, label, isActive, run }) => (
        <ToolbarButton
          key={label}
          label={label}
          active={isActive()}
          disabled={disabled}
          onClick={run}
        >
          <Icon className="size-3.5" aria-hidden />
        </ToolbarButton>
      ))}

      <ToolbarButton
        label="Link"
        active={editor.isActive("link")}
        disabled={disabled}
        onClick={() => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const href = window.prompt("Link address (https://… or mailto:…)");
          if (!href) return;
          // The editor's own protocol allowlist rejects anything else, but
          // checking here too means the author is told immediately rather than
          // having the link silently dropped.
          if (!/^(https?:\/\/|mailto:)/i.test(href.trim())) {
            window.alert("Links must start with http://, https:// or mailto:");
            return;
          }
          editor.chain().focus().setLink({ href: href.trim() }).run();
        }}
      >
        <LinkIcon className="size-3.5" aria-hidden />
      </ToolbarButton>

      <span className="bg-border mx-1 h-4 w-px" aria-hidden />

      <ToolbarButton
        label="Undo"
        disabled={disabled}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="size-3.5" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        disabled={disabled}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="size-3.5" aria-hidden />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Without this the button submits the form it sits in.
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-md transition",
        active
          ? "bg-signal-soft text-signal-text"
          : "text-muted-foreground hover:bg-surface hover:text-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {children}
    </button>
  );
}
