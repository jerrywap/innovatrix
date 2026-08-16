"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import type { NotificationCategory } from "@/lib/db/enums";
import { setPreferenceAction } from "../actions";

/**
 * Notification preferences — §69.
 *
 * ## Essential categories are shown, locked, and explained
 *
 * Not hidden. §69 says "mark them clearly in the UI", and a missing switch
 * reads as an oversight — somebody looks for the billing toggle, does not find
 * it, and assumes the screen is broken. A visible, disabled row with a reason
 * beside it answers the question before it is asked.
 *
 * ## Each switch is its own form
 *
 * So one save cannot silently overwrite another, and so a failure names the row
 * it belongs to. `useActionState` per row rather than a single submit button
 * also means the screen has no unsaved state to lose.
 */

const CATEGORY_COPY: Record<
  NotificationCategory,
  { label: string; description: string; locked?: string }
> = {
  requests: {
    label: "Requests",
    description: "Updates on the work you've asked us for.",
  },
  quotes: { label: "Quotes", description: "When a quote is ready or has changed." },
  billing: {
    label: "Billing",
    description: "Invoices, payments and receipts.",
    locked: "We have to tell you about money.",
  },
  products: { label: "Software", description: "New versions of what you own." },
  messages: { label: "Messages", description: "Replies on your conversations with us." },
  security: {
    label: "Security",
    description: "Sign-ins, password changes and account alerts.",
    locked: "Always on, for your account's safety.",
  },
};

export function NotificationPreferences({ muted }: { muted: string[] }) {
  const mutedSet = new Set(muted);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-[16px] tracking-[-0.02em]">Email notifications</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          {/* Said once, plainly, rather than repeated on every locked row. */}
          Everything still appears in your notifications here — this only changes what we email
          you.
        </p>
      </div>

      <ul className="border-border divide-border divide-y rounded-xl border">
        {(Object.keys(CATEGORY_COPY) as NotificationCategory[]).map((category) => (
          <Row
            key={category}
            category={category}
            enabled={!mutedSet.has(`${category}:email`)}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({ category, enabled }: { category: NotificationCategory; enabled: boolean }) {
  const [state, submit] = useActionState(setPreferenceAction, null);
  const copy = CATEGORY_COPY[category];

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[14px] font-medium">
          {copy.label}
          {copy.locked && <Lock className="text-subtle size-3" aria-hidden />}
        </p>
        <p className="text-muted-foreground text-[13px]">{copy.description}</p>
        {copy.locked && <p className="text-subtle text-[12px]">{copy.locked}</p>}
        {state?.ok === false && (
          <p className="text-[12px] text-[var(--danger)]">{state.error}</p>
        )}
      </div>

      {copy.locked ? (
        <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
          always on
        </span>
      ) : (
        <form action={submit}>
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="channel" value="email" />
          {/* The submitted value is the *new* state, so the control reads as
              what it will do rather than what it currently is. */}
          <input type="hidden" name="enabled" value={enabled ? "false" : "on"} />
          <button
            type="submit"
            className="border-border hover:bg-surface-muted rounded-full border px-3 py-1 text-[12.5px]"
          >
            {enabled ? "Turn off" : "Turn on"}
            <span className="sr-only"> email about {copy.label.toLowerCase()}</span>
          </button>
        </form>
      )}
    </li>
  );
}
