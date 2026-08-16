"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { Route } from "next";
import { Check, CheckCheck } from "lucide-react";
import type { NotificationRow } from "../notification-view";
import { markAllReadAction, markReadAction } from "../actions";

const CATEGORY_LABEL: Record<string, string> = {
  requests: "Request",
  quotes: "Quote",
  billing: "Billing",
  products: "Software",
  messages: "Message",
  security: "Security",
};

/**
 * The notification centre — §69.
 *
 * ## The row is a link, and marking read is a separate control
 *
 * Opening the thing and dismissing the notice are different intentions. A row
 * that marks itself read on click means somebody who opens a notification,
 * realises it is not what they wanted and goes back has lost their place in the
 * list — and the unread count is the only record of "I still need to deal with
 * this".
 *
 * ## Absolute dates
 *
 * "3 days ago" is computed differently on the server and the client and
 * flickers at hydration. The convention holds here even though a notification
 * list is the most tempting place in the app to break it.
 */
export function NotificationList({
  rows,
  unread,
}: {
  rows: NotificationRow[];
  unread: number;
}) {
  const [, clearAll] = useActionState(markAllReadAction, null);

  return (
    <div className="flex flex-col gap-3">
      {unread > 0 && (
        <form action={clearAll} className="self-end">
          <MarkAll />
        </form>
      )}

      <ul className="border-border divide-border divide-y rounded-xl border">
        {rows.map((row) => (
          <li
            key={row.id}
            className={
              row.read
                ? "flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                : "bg-surface-muted flex flex-wrap items-start justify-between gap-3 px-4 py-3"
            }
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[14px]">
                {!row.read && (
                  <span
                    className="bg-signal size-1.5 shrink-0 rounded-full"
                    // The dot is decoration; the word below carries the meaning
                    // for anyone who cannot see it.
                    aria-hidden
                  />
                )}
                {row.href ? (
                  <Link href={row.href as Route} className="underline-offset-4 hover:underline">
                    {row.title}
                  </Link>
                ) : (
                  row.title
                )}
                {!row.read && <span className="sr-only">(unread)</span>}
              </p>
              {row.body && (
                <p className="text-muted-foreground mt-0.5 text-[13px]">{row.body}</p>
              )}
              <p className="text-subtle font-mono text-[11px]">
                {CATEGORY_LABEL[row.category] ?? row.category} · {row.at}
              </p>
            </div>

            {!row.read && <MarkOne id={row.id} title={row.title} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MarkOne({ id, title }: { id: string; title: string }) {
  const [, submit] = useActionState(markReadAction, null);

  return (
    <form action={submit}>
      <input type="hidden" name="notificationId" value={id} />
      <button
        type="submit"
        // The visible name is an icon, so the accessible name has to be the
        // whole thing — and it names *which* notification (WCAG 2.4.6).
        aria-label={`Mark "${title}" as read`}
        className="text-subtle hover:text-foreground shrink-0 rounded-full p-1.5"
      >
        <Check className="size-4" aria-hidden />
      </button>
    </form>
  );
}

function MarkAll() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-subtle hover:text-foreground flex items-center gap-1.5 text-[12.5px]"
    >
      <CheckCheck className="size-3.5" aria-hidden />
      Mark everything read
    </button>
  );
}
