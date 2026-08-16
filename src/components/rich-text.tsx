import { cn } from "@/lib/utils";

/**
 * Render customer- or staff-authored prose.
 *
 * ## Why this does not accept HTML
 *
 * The obvious version of this component takes `dangerouslySetInnerHTML` and a
 * sanitiser. That is a standing invitation to stored XSS: the sanitiser is one
 * dependency bump, one config change or one `svg` allowance away from letting
 * something through, and the payload is stored, so it fires for every viewer
 * from then on.
 *
 * Product descriptions, quote notes, request briefs and messages are all
 * written by people typing sentences. So the input is **plain text**, and the
 * only structure recognised is what the typing already implies: blank lines
 * separate paragraphs, and `- ` at the start of a line makes a bullet. React
 * escapes every character of it.
 *
 * If a genuine rich-text editor is ever needed, it should store a structured
 * document (a node tree) and render node types — never a string of HTML.
 * Ticket 26 should treat any appearance of `dangerouslySetInnerHTML` in this
 * codebase as a finding.
 */
export function RichText({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  if (!text?.trim()) return null;

  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className={cn("flex flex-col gap-3 text-[14px] leading-relaxed", className)}>
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const isList = lines.every((line) => /^\s*[-*•]\s+/.test(line));

        if (isList) {
          return (
            <ul key={index} className="flex list-disc flex-col gap-1 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{line.replace(/^\s*[-*•]\s+/, "")}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="whitespace-pre-line">
            {block}
          </p>
        );
      })}
    </div>
  );
}
