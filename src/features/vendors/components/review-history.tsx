import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import type { VendorReviewNoteView } from "@/services/catalog/product-view";

/**
 * What has been said about this product, in order — vendor ticket 05.
 *
 * ## Appended, and shown as a history rather than a latest state
 *
 * The third submission of a product is only comprehensible next to what was said
 * about the first two. A "latest feedback" panel turns a conversation into a rumour,
 * and a vendor who cannot see that they already fixed something argues about it.
 *
 * ## `internalNote` is not on the type
 *
 * `VendorReviewNoteView` has no such field, because `toVendorReviewNotes()` does not
 * select it. This component could not render a reviewer's private note if it tried,
 * which is the §37 guarantee in the only form worth having — not a component that
 * chooses to skip a field it was handed.
 *
 * A Server Component: it renders text and dates and has nothing to be interactive
 * about.
 */
export function ReviewHistory({ notes }: { notes: readonly VendorReviewNoteView[] }) {
  if (notes.length === 0) return null;

  // Newest first: the thing a vendor came to read is the most recent decision.
  const ordered = [...notes].reverse();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Review history</h2>

      <ol className="border-border divide-border divide-y rounded-xl border">
        {ordered.map((note, index) => (
          <li key={`${note.at}-${index}`} className="flex flex-col gap-2 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                status={outcomeStatus(note.outcome)}
                label={outcomeLabel(note.outcome)}
              />
              <span className="text-subtle font-mono text-[11px]">
                {formatDateTime(note.at)}
              </span>
            </div>

            {/* Rendered as text and escaped by React. It is prose written by one party
                and read by another. */}
            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{note.detail}</p>

            {note.reasons.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {note.reasons.map((reason) => (
                  <li
                    key={reason}
                    className="border-border rounded-full border px-2 py-0.5 text-[11px] capitalize"
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            )}

            {note.changedSections.length > 0 && (
              <p className="text-subtle text-[12px]">
                Changed since the last approval: {note.changedSections.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Reuse the shared tone vocabulary rather than inventing colours here.
 *
 * `submitted` and `changes_requested` are already product statuses with tones, so a
 * note about one reads the same colour as the badge on the product itself — which is
 * the whole reason `StatusBadge` keys on the raw enum value.
 */
function outcomeStatus(outcome: string): string {
  switch (outcome) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "changes_requested";
    case "withdrawn":
      return "draft";
    default:
      return "submitted";
  }
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "approved":
      return "Passed review";
    case "changes_requested":
      return "Changes requested";
    case "withdrawn":
      return "Withdrawn";
    default:
      return "Submitted";
  }
}
