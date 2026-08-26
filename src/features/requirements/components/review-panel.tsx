"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useManualSubmit } from "@/features/products/components/section-form";
import { RequestSuccess } from "./request-success";
import { submitRequirementsAction, type SummaryLine } from "../actions";

/**
 * §18 — the brief, as a document rather than a form.
 *
 * ## Every line is editable, and the tick is what confirms it
 *
 * §18 requires this, and §34 depends on it: `customerRequirements` means the
 * customer confirmed them. The assistant's `origin` is a *starting position* —
 * including a line the model only assumed makes it confirmed, and leaving one out
 * keeps it an assumption however sure the model sounded. The action decides that
 * from the checkbox, not from the `origin` we send, so nothing here can promote a
 * line by accident.
 *
 * ## Provenance is a heading, not a badge
 *
 * The lines used to arrive as one list, ticked or dashed, each with an uppercase
 * `we suggested this` under it that read like debug output. Two sections say the
 * same thing better: what came out of the conversation, then what we thought of
 * ourselves. A customer skimming can see which half is theirs, which is the half
 * that matters — the lines nobody notices are the lines that get built.
 *
 * ## Progressive disclosure, because the form was longer than the brief
 *
 * Every line, included or not, used to render two text inputs, a checkbox and a
 * delete button. Ten suggestions was twenty inputs for a document the customer
 * had not agreed to yet. Now an unselected suggestion is a sentence with
 * `+ Include` beside it and nothing else; its fields appear when it is included,
 * and its optional detail only when asked for. The payload is unchanged — the
 * values travel in hidden inputs — so a declined suggestion still reaches the
 * request as `suggested`, which §23 requires and which tells the reviewer what
 * was considered.
 *
 * ## Why this dispatches by hand
 *
 * `<form action={submit}>` was wrong here and had been from the start. React runs
 * a function action through `startHostTransition`, which requests a real DOM
 * `form.reset()` **before** the action — including on a failed submit. Native
 * inputs survive it because React writes their fresh `defaultValue` in the same
 * commit; the `defaultValue`-based requirement fields did **not**, so a
 * validation failure silently restored every label the customer had edited to
 * whatever the model first proposed. `useManualSubmit` calls `preventDefault()`,
 * which puts React on the `action === null` path and requests no reset. Two
 * consequences, both handled: `useFormStatus` reports nothing for a manual
 * dispatch, so `pending` travels as a prop; and every field here is controlled,
 * so a reset could not lose anything even if one were requested.
 *
 * ## Sending it has to look like it happened
 *
 * It did not. `submitRequirementsAction` returned `ok({ reference })`, this
 * component rendered the failure branch and **nothing at all** for success, and
 * the form stayed on screen with every field still filled in. A customer pressed
 * the button, saw no change, reloaded, filled it in again and pressed again —
 * three times, producing CUS-2026-0001 through 0003, all with the same title, all
 * real, all in the staff queue. Reloading is what turned "no feedback" into
 * duplicate work: a fresh load starts a fresh conversation, and
 * `submitFromConversation` is idempotent *per conversation*. So success replaces
 * the form outright with `RequestSuccess`.
 */
export interface Brief {
  title: string;
  lines: SummaryLine[];
  timeline: string;
  /** True when there was no summary to draft — §104's manual path. */
  manual: boolean;
}

export function ReviewPanel({
  conversationId,
  signedIn,
  signInHref,
  brief,
  onBriefChange,
}: {
  conversationId: string;
  signedIn: boolean;
  signInHref: string;
  brief: Brief;
  onBriefChange: (brief: Brief) => void;
}) {
  const { state, pending, onSubmit } = useManualSubmit(submitRequirementsAction);

  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(brief.lines.map((line) => [line.key, line.origin === "confirmed"])),
  );
  const [detailOpen, setDetailOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      brief.lines.filter((line) => line.detail).map((line) => [line.key, true]),
    ),
  );
  const [editingTitle, setEditingTitle] = useState(brief.title.trim().length === 0);
  const [notes, setNotes] = useState("");
  const [hasDeadline, setHasDeadline] = useState(brief.timeline.trim().length > 0);

  const sentHeading = useRef<HTMLDivElement>(null);
  // `state.ok` rather than `state`: a failed submit re-renders too, and stealing
  // focus from the field somebody is fixing would be worse than saying nothing.
  useEffect(() => {
    if (state?.ok) sentHeading.current?.focus();
  }, [state?.ok]);

  if (state?.ok) {
    return (
      /*
       * Focused rather than announced through a live region. `role="status"` on a
       * node that mounts already-populated is announced inconsistently across
       * screen readers, and the form this replaces was the thing that had focus —
       * so moving focus here is both the reliable announcement and the right
       * place to land.
       */
      <div ref={sentHeading} tabIndex={-1} className="focus-visible:outline-none">
        <RequestSuccess
          reference={state.data.reference}
          {...(state.data.submittedAt ? { submittedAt: state.data.submittedAt } : {})}
          status={state.data.status}
        />
      </div>
    );
  }

  const setLines = (lines: SummaryLine[]) => onBriefChange({ ...brief, lines });
  const fromConversation = brief.lines.filter((line) => line.origin === "confirmed");
  const suggested = brief.lines.filter((line) => line.origin !== "confirmed");

  function updateLine(key: string, patch: Partial<SummaryLine>) {
    setLines(brief.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    setLines(brief.lines.filter((line) => line.key !== key));
  }

  function addLine() {
    const line = blank();
    setLines([...brief.lines, line]);
    setIncluded((current) => ({ ...current, [line.key]: true }));
    setDetailOpen((current) => ({ ...current, [line.key]: false }));
  }

  return (
    <form onSubmit={onSubmit} id="manual-form" className="flex flex-col gap-9">
      <input type="hidden" name="conversationId" value={conversationId} />

      {/* ── the moment ───────────────────────────────────────── */}
      <header className="flex flex-col gap-3">
        {!brief.manual && (
          <p className="text-signal-text flex items-center gap-1.5 text-[12.5px] font-medium">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
            Discovery complete
          </p>
        )}

        <h1 className="font-display text-[clamp(1.6rem,3vw,2.1rem)] leading-[1.1] tracking-[-0.03em]">
          {brief.manual ? "Tell us what you need." : "We think we’ve got it."}
        </h1>

        <p className="text-muted-foreground max-w-[36rem] text-[14px] leading-relaxed">
          {brief.manual
            ? "Write down what you need, one line at a time. A person reads all of it."
            : "Here’s what we understood. Change anything we got wrong, include anything we suggested that you want, and leave out what you don’t."}
        </p>
      </header>

      {/* ── the project name ─────────────────────────────────── */}
      <section className="flex flex-col gap-1.5">
        <p className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
          Project
        </p>

        {editingTitle ? (
          <div className="flex items-center gap-2">
            <Input
              name="title"
              value={brief.title}
              onChange={(event) => onBriefChange({ ...brief, title: event.target.value })}
              maxLength={140}
              required
              autoFocus
              aria-label="Project name"
              placeholder="Rota system for a care agency"
              className="font-display h-auto py-1.5 text-[20px] tracking-[-0.02em]"
            />
            {brief.title.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setEditingTitle(false)}
                className="text-subtle hover:text-foreground shrink-0 text-[12.5px] underline underline-offset-4"
              >
                Done
              </button>
            )}
          </div>
        ) : (
          /*
           * A heading with an Edit affordance, not an input box.
           *
           * §17: the customer should feel we turned their conversation into
           * something, and a text field full of our words looks like another form
           * to complete. The value still submits — the hidden input below carries
           * it — so the document reading is presentational only.
           */
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <input type="hidden" name="title" value={brief.title} />
            <h2 className="font-display text-[20px] tracking-[-0.02em]">{brief.title}</h2>
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="text-subtle hover:text-foreground flex items-center gap-1 text-[12px] underline underline-offset-4"
            >
              <Pencil className="size-3" aria-hidden />
              Edit
              <span className="sr-only"> the project name</span>
            </button>
          </div>
        )}
      </section>

      {/* ── from your conversation ───────────────────────────── */}
      {fromConversation.length > 0 && (
        <section className="flex flex-col gap-1">
          <SectionLabel>From your conversation</SectionLabel>
          <ul className="border-border divide-border divide-y border-t">
            {fromConversation.map((line) => (
              <RequirementRow
                key={line.key}
                line={line}
                index={brief.lines.indexOf(line)}
                included={included[line.key] ?? true}
                detailOpen={detailOpen[line.key] ?? false}
                onToggleIncluded={(next) =>
                  setIncluded((current) => ({ ...current, [line.key]: next }))
                }
                onToggleDetail={() =>
                  setDetailOpen((current) => ({ ...current, [line.key]: !current[line.key] }))
                }
                onChange={(patch) => updateLine(line.key, patch)}
                onRemove={() => removeLine(line.key)}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── what we suggested ────────────────────────────────── */}
      {suggested.length > 0 && (
        <section className="flex flex-col gap-1">
          <SectionLabel>
            CoSetup also suggests
            <span className="text-subtle ml-2 normal-case">
              &mdash; nothing here is included until you say so
            </span>
          </SectionLabel>
          <ul className="border-border divide-border divide-y border-t">
            {suggested.map((line) => (
              <RequirementRow
                key={line.key}
                line={line}
                index={brief.lines.indexOf(line)}
                included={included[line.key] ?? false}
                detailOpen={detailOpen[line.key] ?? false}
                onToggleIncluded={(next) =>
                  setIncluded((current) => ({ ...current, [line.key]: next }))
                }
                onToggleDetail={() =>
                  setDetailOpen((current) => ({ ...current, [line.key]: !current[line.key] }))
                }
                onChange={(patch) => updateLine(line.key, patch)}
                onRemove={() => removeLine(line.key)}
              />
            ))}
          </ul>
        </section>
      )}

      <div>
        <Button type="button" variant="outline" onClick={addLine} className="w-fit">
          <Plus className="size-3.5" aria-hidden />
          Add another requirement
        </Button>
      </div>

      {/* ── deadline ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-2.5">
        <SectionLabel>Is there a deadline?</SectionLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Choice
            selected={!hasDeadline}
            onClick={() => {
              setHasDeadline(false);
              onBriefChange({ ...brief, timeline: "" });
            }}
          >
            No fixed date
          </Choice>
          <Choice selected={hasDeadline} onClick={() => setHasDeadline(true)}>
            There&rsquo;s a date in mind
          </Choice>
        </div>

        {/*
          Free text, not a date picker. "Before the end of March" and "when the
          new site launches" are the answers people actually have, and a date
          input would force them to invent a day. It is business context either
          way — §40 forbids implying a deadline is guaranteed, and it is not.
        */}
        {hasDeadline && (
          <Input
            name="timeline"
            value={brief.timeline}
            onChange={(event) => onBriefChange({ ...brief, timeline: event.target.value })}
            maxLength={200}
            autoFocus
            aria-label="The date you're working to"
            placeholder="e.g. before the end of March, or 14 May"
            className="sm:max-w-[24rem]"
          />
        )}
      </section>

      {/* ── anything else ────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <label htmlFor="notes" className="w-fit">
          <SectionLabel>Anything else?</SectionLabel>
        </label>
        {/*
          Starts empty, always.

          It used to be prefilled from the extractor's `notes`, which put
          sentences like "Conversation is in early discovery; the customer has not
          yet answered which manual processes cause the biggest issues" into a
          field attributed to the customer — our reading of them, in their voice,
          ready to submit as their own words. The action no longer returns it.
        */}
        <Textarea
          id="notes"
          name="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={1200}
          placeholder="Anything we haven't asked about. Optional."
        />
      </section>

      {/* ── send ─────────────────────────────────────────────── */}
      <section className="border-border flex flex-col gap-3 border-t pt-6">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">
          Ready for us to take a look?
        </h2>
        <p className="text-muted-foreground max-w-[34rem] text-[13.5px] leading-relaxed">
          Someone here reads your brief, comes back with anything that needs clarifying, and
          prepares the next step. Nothing is priced automatically.
        </p>

        {state?.ok === false && (
          <p
            role="alert"
            className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-[13px]"
          >
            {state.error}
          </p>
        )}

        {signedIn ? (
          <div className="flex flex-col gap-2">
            <Button type="submit" disabled={pending} className="w-fit">
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Send my request
            </Button>
            {/* Both claims are true: nothing on this path takes payment, and a
                submitted request is quoted before anything is agreed. */}
            <p className="text-subtle text-[12px]">Free to submit &middot; no obligation</p>
          </div>
        ) : (
          // §17: an anonymous visitor may do the whole interview and is asked to
          // sign in only at the point of submitting. The conversation is claimed
          // on the way back, so nothing here is retyped.
          <div className="border-border bg-surface-muted flex flex-col gap-2 rounded-xl border p-3.5">
            <p className="text-[13px]">
              Sign in to send this to us. Everything you&rsquo;ve written stays exactly as it
              is.
            </p>
            <Button asChild className="w-fit">
              <a href={signInHref}>Sign in and send</a>
            </Button>
          </div>
        )}
      </section>
    </form>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">{children}</p>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={
        selected
          ? "border-foreground bg-foreground text-background rounded-full border px-3.5 py-1.5 text-[12.5px]"
          : "border-border hover:border-border-strong rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors"
      }
    >
      {children}
    </button>
  );
}

/**
 * One requirement, in two shapes.
 *
 * **Not included** — a sentence and `+ Include`. Nothing editable, no checkbox,
 * no delete. It is a proposal, and a proposal you have not accepted does not need
 * a text field.
 *
 * **Included** — an editable label, an optional detail behind `Add details`, and
 * a remove control.
 *
 * ## The hidden inputs are the whole payload
 *
 * All four fields travel for every line whatever it is showing, because an
 * excluded suggestion must still reach the request as `suggested` — §23 wants the
 * things the customer declined recorded, since "not sure, leave that for now"
 * tells the reviewer what they are thinking about next. `accepted` is the only
 * field the shape changes, and it is absent when unticked: an unticked checkbox
 * submits nothing, which `parseFormPayload` coerces to `false` rather than
 * letting Zod's default fire.
 *
 * ## Focus-visible, not hover-only
 *
 * The remove control appears on hover **or** focus within the row, and is always
 * present at pointer-coarse widths. A control that only exists under a mouse does
 * not exist on a phone, and §29 rules it out — but a permanent trash icon beside
 * every line was what made the old list read as dangerous.
 */
function RequirementRow({
  line,
  index,
  included,
  detailOpen,
  onToggleIncluded,
  onToggleDetail,
  onChange,
  onRemove,
}: {
  line: SummaryLine;
  index: number;
  included: boolean;
  detailOpen: boolean;
  onToggleIncluded: (next: boolean) => void;
  onToggleDetail: () => void;
  onChange: (patch: Partial<SummaryLine>) => void;
  onRemove: () => void;
}) {
  const field = (name: string) => `lines[${index}][${name}]`;

  return (
    <li className="group focus-within:bg-surface-muted/40 flex flex-col gap-2 py-3.5 transition-colors">
      <input type="hidden" name={field("key")} value={line.key} />
      <input type="hidden" name={field("origin")} value={line.origin} />
      {included && <input type="hidden" name={field("accepted")} value="on" />}

      {included ? (
        <>
          <div className="flex items-start gap-2.5">
            <span
              className="bg-signal-soft mt-0.5 grid size-4 shrink-0 place-items-center rounded-full"
              aria-hidden
            >
              <Check className="text-signal-text size-2.5" strokeWidth={3} />
            </span>

            <Input
              name={field("label")}
              value={line.label}
              onChange={(event) => onChange({ label: event.target.value })}
              maxLength={200}
              aria-label={`Requirement ${index + 1}`}
              /*
               * Borderless until touched. The row is a line in a document, and
               * fifteen bordered boxes down the page is the form this is meant to
               * stop being — but it is still an input, so the border arrives on
               * hover and focus rather than never.
               */
              className="hover:border-border focus-visible:border-ring h-auto border-transparent bg-transparent px-1.5 py-0.5 text-[14px] font-medium shadow-none"
            />

            <button
              type="button"
              onClick={onRemove}
              className="text-subtle hover:text-foreground shrink-0 rounded p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
            >
              <X className="size-3.5" aria-hidden />
              <span className="sr-only">Remove &ldquo;{line.label}&rdquo;</span>
            </button>
          </div>

          <div className="pl-[26px]">
            {detailOpen ? (
              <Input
                name={field("detail")}
                value={line.detail ?? ""}
                onChange={(event) => onChange({ detail: event.target.value })}
                maxLength={600}
                autoFocus
                aria-label={`Details for requirement ${index + 1}`}
                placeholder="Anything specific about this one"
                className="text-[12.5px]"
              />
            ) : (
              <>
                <input type="hidden" name={field("detail")} value={line.detail ?? ""} />
                {line.detail ? (
                  <p className="text-muted-foreground text-[12.5px] leading-relaxed">
                    {line.detail}{" "}
                    <button
                      type="button"
                      onClick={onToggleDetail}
                      className="text-subtle hover:text-foreground underline underline-offset-2"
                    >
                      Edit
                    </button>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={onToggleDetail}
                    className="text-subtle hover:text-foreground text-[12px] underline underline-offset-4"
                  >
                    Add details
                    <span className="sr-only"> for &ldquo;{line.label}&rdquo;</span>
                  </button>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name={field("label")} value={line.label} />
          <input type="hidden" name={field("detail")} value={line.detail ?? ""} />

          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-muted-foreground text-[14px] font-medium">{line.label}</p>
              {line.detail && (
                <p className="text-subtle text-[12.5px] leading-relaxed">{line.detail}</p>
              )}
              <p className="text-subtle mt-1 flex items-center gap-1.5 text-[11px]">
                <Sparkles className="size-3" aria-hidden />
                {/* Replaces `WE SUGGESTED THIS`, which read like a debug label.
                    Both origins say the same thing to a customer — we thought of
                    it, you did not — and the distinction is kept in the data,
                    where the reviewer sees it. */}
                Suggested by CoSetup
              </p>
            </div>

            <button
              type="button"
              onClick={() => onToggleIncluded(true)}
              className="border-border hover:border-border-strong hover:bg-surface-muted flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors"
            >
              <Plus className="size-3.5" aria-hidden />
              Include
              <span className="sr-only"> &ldquo;{line.label}&rdquo;</span>
            </button>
          </div>
        </>
      )}
    </li>
  );
}

let counter = 0;
export function blank(): SummaryLine {
  // Stable within the session and unique across added rows, so React keys and
  // the `included` map do not collide when two blanks are added in a row.
  counter += 1;
  return { key: `custom-${counter}`, label: "", origin: "confirmed" };
}
