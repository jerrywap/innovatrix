"use client";

import { useActionState } from "react";
import { Check, Loader2, Minus } from "lucide-react";
import type { VendorDocumentKind, VendorVerificationLevel } from "@/lib/db/enums";
import { setVerificationWaiverAction, submitVerificationAction } from "../actions";

/**
 * What one level still needs, and the button that hands it over.
 *
 * ## The checklist is the answer to "am I done?"
 *
 * The screen used to be an upload box under a paragraph of prose. Nothing on it
 * distinguished "I have sent everything" from "I have sent one of two things",
 * and nothing ever said the platform had it — so a vendor who had finished could
 * not tell, and the reasonable reading of that is that the process is broken.
 *
 * A requirement is in exactly one of three states, and each looks different at a
 * glance: **sent** (a document of that kind exists), **not applicable** (the
 * vendor said so), or **outstanding**. Submit is available when none are
 * outstanding, which makes the button's own availability the answer.
 *
 * ## Why "Not applicable" is a real, recorded declaration
 *
 * "Optional if you are not registered" left the vendor to decide what a blank
 * meant, and left a reviewer unable to tell a deliberate blank from an abandoned
 * one. Ticking it writes `verificationWaivers` and an audit row, so the reviewer
 * reads "they said this does not apply" — a fact — instead of guessing.
 *
 * It is also what lets the section stop reading as unfinished, which is the
 * behaviour that was asked for: with the last outstanding item waived, the level
 * is complete and says so.
 */

export interface Requirement {
  kind: VendorDocumentKind;
  title: string;
  detail: string;
  /** Whether the vendor may declare it not applicable. */
  waivable?: boolean;
  /** A document of this kind has been uploaded. */
  provided: boolean;
  /** The vendor has declared it not applicable. */
  waived: boolean;
}

export function RequirementList({
  level,
  requirements,
  editable,
}: {
  level: VendorVerificationLevel;
  requirements: readonly Requirement[];
  /** False once the level has been submitted or decided — then this is a summary. */
  editable: boolean;
}) {
  const [waiverState, waiverDispatch, waiverPending] = useActionState(
    setVerificationWaiverAction,
    null,
  );

  const error = waiverState && !waiverState.ok ? waiverState : null;

  return (
    <div className="flex flex-col gap-3">
      <ul className="border-border divide-border divide-y rounded-xl border">
        {requirements.map((item) => (
          <li key={item.kind} className="flex items-start gap-3 p-3.5">
            <Marker provided={item.provided} waived={item.waived} />

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={`text-[13.5px] font-medium ${item.waived ? "text-muted-foreground line-through" : ""}`}
              >
                {item.title}
              </span>
              <span className="text-muted-foreground text-[12.5px] leading-relaxed">
                {item.detail}
              </span>
            </div>

            {item.waivable && editable && !item.provided && (
              <form action={waiverDispatch} className="shrink-0">
                <input type="hidden" name="level" value={level} />
                <input type="hidden" name="kind" value={item.kind} />
                <input type="hidden" name="waived" value={item.waived ? "off" : "on"} />
                {/*
                  A submit button rather than a checkbox with an onChange: this
                  posts to the server either way, and a control that looks like a
                  checkbox but takes a round trip to settle is one people click
                  twice. The pressed state is what the tick expresses.
                */}
                <button
                  type="submit"
                  disabled={waiverPending}
                  aria-pressed={item.waived}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] whitespace-nowrap transition disabled:opacity-50 ${
                    item.waived
                      ? "border-[var(--signal)] text-[var(--signal-text)]"
                      : "border-border hover:bg-surface-muted text-muted-foreground"
                  }`}
                >
                  {waiverPending ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : (
                    <Check
                      className={`size-3 ${item.waived ? "" : "opacity-30"}`}
                      aria-hidden
                    />
                  )}
                  Not applicable
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="text-destructive text-[12.5px]">{error.error}</p>}
    </div>
  );
}

/**
 * The button that hands the level over — **below the uploader, not above it**.
 *
 * It used to sit inside `RequirementList`, which put "Send for review" between
 * the checklist and the upload box. That reads as the last step arriving second,
 * and a disabled button above the control that would enable it invites exactly
 * one interpretation: that the page is broken.
 *
 * So the level now reads top to bottom in the order the work happens — what is
 * needed, then the way to send it, then handing it over — and this is a separate
 * component because those three are separated by markup the page owns.
 */
export function SubmitLevel({
  level,
  requirements,
}: {
  level: VendorVerificationLevel;
  requirements: readonly Requirement[];
}) {
  const [state, dispatch, pending] = useActionState(submitVerificationAction, null);
  const outstanding = requirements.filter((item) => !item.provided && !item.waived);
  const failed = state && !state.ok ? state.error : null;

  return (
    <div className="border-border flex flex-col gap-2 border-t pt-4">
      <form action={dispatch} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="level" value={level} />
        <button
          type="submit"
          disabled={outstanding.length > 0 || pending}
          className="flex items-center gap-2 rounded-full bg-[var(--signal)] px-5 py-2.5 text-[13px] font-medium text-[var(--signal-contrast)] transition disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Send for review
        </button>

        {/*
          The reason, next to the disabled button rather than as a tooltip on it.
          A disabled control with no stated reason is the thing people click
          repeatedly.
        */}
        <p className="text-muted-foreground text-[12.5px]">
          {outstanding.length > 0
            ? `${outstanding.length} still to send: ${outstanding.map((item) => item.title.toLowerCase()).join(", ")}.`
            : "Everything is here. We'll take it from there."}
        </p>
      </form>

      {failed && <p className="text-destructive text-[12.5px]">{failed}</p>}
    </div>
  );
}

function Marker({ provided, waived }: { provided: boolean; waived: boolean }) {
  if (provided) {
    return (
      <span
        aria-label="Sent"
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--signal)] text-[var(--signal-contrast)]"
      >
        <Check className="size-3" strokeWidth={3} aria-hidden />
      </span>
    );
  }

  if (waived) {
    return (
      <span
        aria-label="Not applicable"
        className="border-border text-subtle mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border"
      >
        <Minus className="size-3" aria-hidden />
      </span>
    );
  }

  return (
    <span
      aria-label="Still needed"
      className="border-border-strong mt-0.5 size-5 shrink-0 rounded-full border border-dashed"
    />
  );
}
