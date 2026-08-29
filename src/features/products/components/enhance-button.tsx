"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";

/**
 * The control that asks for a rewrite, and reports when it cannot.
 *
 * ## `type="button"`, and its own pending state
 *
 * `type="button"` because it sits inside the wizard form and would otherwise
 * submit it — `rich-text-editor.tsx` carries the same note on its toolbar.
 *
 * `useTransition` rather than `useFormStatus`: `SectionForm` dispatches by hand,
 * and `useFormStatus` reports nothing for a manual dispatch. That is spelled out
 * in `section-form.tsx`, which passes `pending` down as a prop for the same
 * reason. A button that never leaves "Enhance" while a paid call is in flight is
 * a button people press twice.
 *
 * ## Failure is a sentence, not an error
 *
 * Rate limited, switched off, unconfigured, unreadable reply — every one of
 * these is a case where the author writes it themselves, which they were about
 * to do anyway. So the message renders beside the button and the form is
 * untouched. Nothing here throws.
 */
export function EnhanceButton<T>({
  label,
  disabledReason,
  run,
  onResult,
}: {
  label: string;
  /** Present when AI is off — the button explains rather than disappearing. */
  disabledReason?: string;
  /** Reads the current value and calls the action. */
  run: () => Promise<ActionResult<T>>;
  onResult: (data: T) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (disabledReason) {
    return (
      <span className="text-subtle inline-flex items-center gap-1.5 text-[12px]">
        <Sparkles className="size-3.5" aria-hidden />
        {disabledReason}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            let result: ActionResult<T>;

            try {
              result = await run();
            } catch {
              /*
               * The action rejecting, rather than returning a failure — a lost
               * connection, or a server action that never arrived. Without this
               * the transition ends with the button live again and nothing said,
               * which reads as the press not having registered.
               */
              setError("That didn't reach us. Try again.");
              return;
            }

            if (!result.ok) {
              setError(result.error);
              return;
            }

            onResult(result.data);
          })
        }
        className="border-border hover:bg-surface-muted disabled:text-subtle inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition disabled:cursor-not-allowed"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="text-signal-text size-3.5" aria-hidden />
        )}
        {pending ? "Writing…" : label}
      </button>

      {/*
        `role="status"`, not `alert`: this is the outcome of something the author
        just pressed and is looking at, and an assertive interruption for "you've
        used this a lot in the last hour" is louder than the news deserves.
      */}
      {error && (
        <span role="status" className="text-[12px] text-[var(--danger)]">
          {error}
        </span>
      )}
    </span>
  );
}
