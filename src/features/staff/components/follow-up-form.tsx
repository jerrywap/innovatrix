"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlarmClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createFollowUpAction } from "../actions";

/**
 * "Follow up with them Tuesday" — §39, from wherever you are.
 *
 * ## Collapsed until asked for
 *
 * It sits on the request workspace and on Customer 360, both of which are
 * already dense. A permanently-open form on a screen somebody visits to read
 * something else is noise; one line that expands is not.
 *
 * ## The date offers the answers people actually give
 *
 * "Tomorrow", "Monday", "next week" — because that is how a reminder gets
 * described out loud, and making somebody operate a date picker to say
 * "tomorrow" is the friction that stops them bothering.
 */
export function FollowUpForm({
  organizationId,
  subjectType,
  subjectId,
  returnTo,
}: {
  organizationId: string;
  subjectType: "request" | "order" | "quote" | "invoice" | "organization";
  subjectId: string;
  returnTo: string;
}) {
  const [state, submit] = useActionState(createFollowUpAction, null);
  const [open, setOpen] = useState(false);
  const [dueAt, setDueAt] = useState(() => isoDay(days(1)));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-subtle hover:text-foreground flex w-fit items-center gap-1.5 text-[12.5px]"
      >
        <AlarmClock className="size-3.5" aria-hidden />
        Set a follow-up
      </button>
    );
  }

  return (
    <form
      action={submit}
      className="border-border bg-surface-muted flex flex-col gap-3 rounded-xl border border-dashed p-3.5"
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <h3 className="flex items-center gap-2 text-[13.5px] font-medium">
        <AlarmClock className="text-subtle size-3.5" aria-hidden />
        Set a follow-up
      </h3>

      <label className="flex flex-col gap-1.5">
        <span className="sr-only">What to follow up on</span>
        <Input
          name="note"
          maxLength={500}
          required
          autoFocus
          placeholder="Chase the payment confirmation"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {[
          ["Tomorrow", 1],
          ["In 3 days", 3],
          ["Next week", 7],
          ["In 2 weeks", 14],
        ].map(([label, offset]) => {
          const value = isoDay(days(offset as number));
          return (
            <button
              key={label as string}
              type="button"
              onClick={() => setDueAt(value)}
              aria-pressed={dueAt === value}
              className={
                dueAt === value
                  ? "bg-foreground text-background rounded-full px-3 py-1 text-[12px]"
                  : "border-border hover:bg-surface rounded-full border px-3 py-1 text-[12px]"
              }
            >
              {label}
            </button>
          );
        })}

        <input
          type="date"
          name="dueAt"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
          required
          aria-label="Due date"
          className="border-border bg-background rounded-lg border px-2.5 py-1 text-[12.5px]"
        />
      </div>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && <p className="text-subtle text-[12.5px]">Saved.</p>}

      <div className="flex items-center gap-2">
        <Submit />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-subtle hover:text-foreground text-[12.5px]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Set reminder
    </Button>
  );
}

function days(offset: number): Date {
  return new Date(Date.now() + offset * 86_400_000);
}

/** `<input type="date">` wants `YYYY-MM-DD` and nothing else. */
function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
