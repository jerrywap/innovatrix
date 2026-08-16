import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

/**
 * Chronological history — §70.
 *
 * Used for a request's journey, an order's fulfilment, a quote's revisions.
 * Newest first: the current state is the thing being looked for, and burying it
 * under a year of history is how audit trails become unread.
 *
 * **Internal entries never render here for a customer.** §37 is absolute about
 * that, and the guard is not this component — it is the query that fed it. A
 * component prop is a rendering decision; leaking an internal note is a
 * disclosure. `isInternal` exists only so staff screens can mark what a
 * customer would not have seen.
 */

export interface TimelineEntry {
  id: string;
  title: string;
  detail?: string;
  at: Date;
  /** Rendered as a StatusBadge when present, so colour matches everywhere. */
  status?: string;
  actor?: string;
  /** Staff view only. See the note above — filtering happens in the query. */
  isInternal?: boolean;
}

export function Timeline({
  entries,
  className,
}: {
  entries: readonly TimelineEntry[];
  className?: string;
}) {
  if (entries.length === 0) {
    return <p className="text-subtle text-[13px]">Nothing has happened yet.</p>;
  }

  const ordered = [...entries].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <ol className={cn("relative flex flex-col", className)}>
      {ordered.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3.5 pb-5 last:pb-0">
          {/* The rail. Stops at the last node rather than trailing into space. */}
          {index < ordered.length - 1 && (
            <span className="bg-border absolute top-3 bottom-0 left-[5px] w-px" aria-hidden />
          )}

          <span
            className={cn(
              "relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4",
              index === 0 ? "bg-signal ring-signal-soft" : "bg-border-strong ring-background",
            )}
            aria-hidden
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13.5px] font-medium">{entry.title}</p>
              {entry.status && <StatusBadge status={entry.status} />}
              {entry.isInternal && (
                <span className="border-border text-subtle rounded-full border px-2 py-0.5 text-[11px]">
                  Internal
                </span>
              )}
            </div>

            {entry.detail && (
              <p className="text-muted-foreground mt-1 text-[13px]">{entry.detail}</p>
            )}

            <p className="text-subtle mt-1 text-[12px]">
              <time dateTime={entry.at.toISOString()}>{formatWhen(entry.at)}</time>
              {entry.actor && <> · {entry.actor}</>}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Absolute dates, not "3 days ago".
 *
 * Relative time is friendlier and useless in an audit trail — and it makes the
 * server and client disagree at hydration, because they render at different
 * moments. A fixed locale keeps the two in step.
 */
function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}
