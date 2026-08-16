"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { Route } from "next";
import { AlarmClock, Check, Loader2, X } from "lucide-react";
import { resolveFollowUpAction } from "../actions";
import type { FollowUpRow } from "../follow-ups";

/**
 * The rows, with the two things you do to one.
 *
 * Overdue is red and says how it is overdue, rather than showing a date the
 * reader has to compare against today. §39 wants it prominent; a date is not
 * prominent, "3 days late" is.
 */
export function FollowUpList({ rows }: { rows: FollowUpRow[] }) {
  return (
    <ul className="border-border divide-border divide-y rounded-xl border">
      {rows.map((row) => (
        <li
          key={row.id}
          className={
            row.overdue
              ? "flex flex-wrap items-center justify-between gap-3 bg-[var(--danger)]/5 px-4 py-3"
              : "flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          }
        >
          <div className="min-w-0">
            <p className="text-[13.5px]">{row.note}</p>
            <p className="text-subtle font-mono text-[11.5px]">
              {row.organizationName}
              {row.subjectReference ? ` · ${row.subjectReference}` : ""}
              {` · ${row.ownerName}`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span
              className={
                row.overdue
                  ? "flex items-center gap-1 font-mono text-[11.5px] text-[var(--danger)]"
                  : "text-subtle flex items-center gap-1 font-mono text-[11.5px]"
              }
            >
              <AlarmClock className="size-3.5" aria-hidden />
              {row.overdue ? `due ${row.dueAt}` : row.dueAt}
            </span>

            {row.subjectReference && (
              <Link
                href={`/staff/requests/${row.subjectReference}` as Route}
                className="text-subtle hover:text-foreground text-[12px] underline underline-offset-4"
              >
                Open
              </Link>
            )}

            {row.status === "open" && (
              <span className="flex items-center gap-1.5">
                <Resolve id={row.id} outcome="done" />
                <Resolve id={row.id} outcome="cancelled" />
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * One form per button rather than one form with two submits.
 *
 * `useFormStatus` reports the status of its *nearest* form, so two buttons in
 * one form both spin when either is pressed — which reads as "both are
 * happening" on an action that is one or the other.
 */
function Resolve({ id, outcome }: { id: string; outcome: "done" | "cancelled" }) {
  const [, submit] = useActionState(resolveFollowUpAction, null);

  return (
    <form action={submit}>
      <input type="hidden" name="followUpId" value={id} />
      <input type="hidden" name="outcome" value={outcome} />
      <ResolveButton outcome={outcome} />
    </form>
  );
}

function ResolveButton({ outcome }: { outcome: "done" | "cancelled" }) {
  const { pending } = useFormStatus();
  const done = outcome === "done";

  return (
    <button
      type="submit"
      disabled={pending}
      title={done ? "Mark as done" : "No longer needed"}
      className="text-subtle hover:text-foreground p-1 disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : done ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <X className="size-3.5" aria-hidden />
      )}
      <span className="sr-only">{done ? "Mark as done" : "No longer needed"}</span>
    </button>
  );
}
