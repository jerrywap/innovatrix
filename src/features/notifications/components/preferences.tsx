"use client";

import { useActionState } from "react";
import { Check, Lock } from "lucide-react";
import { CATEGORY_COPY } from "@/lib/notification-categories";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/db/enums";
import { cn } from "@/lib/utils";
import { setPreferenceAction } from "../actions";

/**
 * Which categories email you.
 *
 * ## The mechanism was never the problem
 *
 * `enabledChannels()` has always read this and dropped the email channel for a
 * muted category, before the notification row is written and with the decision
 * stored on it — which is also what stops the retry sweep resurrecting a
 * suppressed email. What changed here is only how it reads.
 *
 * ## Each switch is its own form
 *
 * So one save cannot silently overwrite another, and so a failure names the row
 * it belongs to. There is no unsaved state on the screen to lose.
 *
 * ## A `role="switch"` button, not a Radix `Switch`
 *
 * It looks like a switch and announces itself as one, and it is a submit button —
 * so it works with **no JavaScript at all**. A Radix `Switch` inside
 * `<form action={fn}>` is the combination `section-form.tsx` documents at length:
 * React 19 requests a form reset before the action runs, and Radix answers a
 * `reset` by restoring a ref captured on first render, so the control silently
 * reverts. The escape is `useManualSubmit`, which costs progressive enhancement.
 * A native control costs nothing.
 *
 * ## Locked rows are shown, not hidden
 *
 * §69 asks for them to be marked clearly. A missing billing switch reads as an
 * oversight — somebody looks for it, does not find it, and concludes the screen is
 * broken. A visible, disabled row with its reason beside it answers the question
 * before it is asked. The list of locked categories and the list that ignores
 * preferences are now one list, derived in `lib/notification-categories.ts`, so
 * the lock and the behaviour cannot disagree.
 */
export function NotificationPreferences({ muted }: { muted: string[] }) {
  const mutedSet = new Set(muted);

  return (
    <section className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-5">
      <div>
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Email notifications</h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
          Everything still appears in your notifications here &mdash; this only changes what we
          email you. Turning a category off takes effect on the next thing that happens.
        </p>
      </div>

      <ul className="border-border divide-border divide-y rounded-xl border">
        {NOTIFICATION_CATEGORIES.map((category) => (
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
  const [state, submit, pending] = useActionState(setPreferenceAction, null);
  const copy = CATEGORY_COPY[category];

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[14px] font-medium">
          {copy.label}
          {copy.locked && <Lock className="text-subtle size-3" aria-hidden />}
        </p>
        <p className="text-muted-foreground text-[13px]">{copy.description}</p>
        {copy.locked && <p className="text-subtle text-[12px]">{copy.locked}</p>}
        {state?.ok === false && (
          <p role="alert" className="text-[12px] text-[var(--danger)]">
            {state.error}
          </p>
        )}
      </div>

      {copy.locked ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-300">
          <Check className="size-3.5" aria-hidden />
          Always on
        </span>
      ) : (
        <form action={submit} className="shrink-0">
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="channel" value="email" />
          {/* The submitted value is the state being asked for, not the current one. */}
          <input type="hidden" name="enabled" value={enabled ? "false" : "on"} />
          <button
            type="submit"
            role="switch"
            aria-checked={enabled}
            disabled={pending}
            className={cn(
              "focus-visible:ring-ring relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:opacity-60",
              enabled ? "bg-signal border-signal" : "bg-surface-muted border-border-strong",
            )}
          >
            {/*
              The visible name is the category, which is in the row already — so the
              accessible name has to carry it too, or a screen reader hears eight
              identical switches. WCAG 2.5.3 wants the visible text contained in the
              accessible name; there is no visible text on the control itself, so an
              `sr-only` span is the whole name rather than an override of one.
            */}
            <span className="sr-only">Email me about {copy.label.toLowerCase()}</span>
            <span
              aria-hidden
              className={cn(
                "bg-surface pointer-events-none block size-4.5 rounded-full shadow-sm transition-transform",
                enabled ? "translate-x-[1.4rem]" : "translate-x-[0.15rem]",
              )}
            />
          </button>
        </form>
      )}
    </li>
  );
}
