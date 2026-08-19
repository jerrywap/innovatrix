"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  submitRequirementsAction,
  summariseConversationAction,
  type SummaryLine,
} from "../actions";

/**
 * §18 — the summary, as a document rather than a chat bubble.
 *
 * ## Every line is editable, and the tick is what confirms it
 *
 * §18 requires this, and §34 depends on it: `customerRequirements` means the
 * customer confirmed them. The assistant's `origin` is a *starting position* —
 * ticking a line the model only assumed makes it confirmed, and leaving a line
 * unticked keeps it an assumption however sure the model sounded.
 *
 * ## Assumptions look different, on purpose
 *
 * Not a subtle shade — a labelled badge and an unticked box. A customer
 * skim-reading must be able to see at a glance which lines are theirs and
 * which are the machine's, because the ones they don't notice are the ones
 * that get built.
 *
 * ## It works with no AI at all
 *
 * `signedIn === false` or a failed summary both land on the same editor with an
 * empty line in it. §104: the customer must be able to submit regardless.
 *
 * ## Sending it has to look like it happened
 *
 * It did not. `submitRequirementsAction` returned `ok({ reference })`, this component
 * rendered the failure branch and **nothing at all** for success, and the form stayed on
 * screen with every field still filled in. A customer pressed the button, saw no change,
 * reloaded, filled it in again and pressed it again — three times, producing CUS-2026-0001
 * through 0003, all with the same title, all real, all in the staff queue.
 *
 * Reloading is what turned "no feedback" into duplicate work: a fresh page load starts a
 * fresh conversation, and `submitFromConversation` is idempotent *per conversation*, so the
 * second attempt was a genuinely new request rather than a rejected repeat. The one thing
 * that stops this is telling the customer it worked, so the confirmation replaces the form
 * outright and carries the reference.
 */
export function ReviewPanel({
  conversationId,
  signedIn,
  signInHref,
  initialTitle,
  startOpen = false,
}: {
  conversationId: string;
  signedIn: boolean;
  signInHref: string;
  initialTitle?: string;
  /**
   * Open straight into the editor, skipping the "Ready to send it to us?" card.
   *
   * Set when the assistant itself has failed, which is the one case where
   * offering to summarise a conversation would be absurd — there isn't one.
   * §104's degradation path has to land on something the customer can type in.
   */
  startOpen?: boolean;
}) {
  // Lazy: `blank()` bumps a module-level counter, and a bare call here would
  // run it on every render rather than only on mount.
  const [lines, setLines] = useState<SummaryLine[]>(() => (startOpen ? [blank()] : []));
  const [title, setTitle] = useState(initialTitle ?? "");
  const [timeline, setTimeline] = useState("");
  const [notes, setNotes] = useState("");
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [opened, setOpened] = useState(startOpen);

  const [state, submit] = useActionState(submitRequirementsAction, null);

  const sentHeading = useRef<HTMLHeadingElement>(null);
  // `state.ok` in the dependency rather than `state`: a failed submit re-renders too, and
  // stealing focus from the field somebody is fixing would be worse than saying nothing.
  useEffect(() => {
    if (state?.ok) sentHeading.current?.focus();
  }, [state?.ok]);

  async function draft() {
    setDrafting(true);
    setDraftError(null);

    const result = await summariseConversationAction(conversationId);
    setDrafting(false);
    setOpened(true);

    if (!result.ok) {
      setDraftError(result.error);
      // Still open the editor with one empty line — the customer writes it out
      // themselves rather than being stuck.
      if (lines.length === 0) setLines([blank()]);
      return;
    }

    setLines(result.data.lines);
    setTitle(result.data.title);
    setTimeline(result.data.timeline ?? "");
    setNotes(result.data.notes ?? "");
    setAccepted(
      Object.fromEntries(
        result.data.lines.map((line) => [line.key, line.origin === "confirmed"]),
      ),
    );
  }

  /*
   * Sent — and the form is *gone*, not merely accompanied by a message.
   *
   * A confirmation above a still-filled form invites exactly the second press this whole
   * branch exists to prevent, and the fields are no longer editable in any useful sense:
   * the request is in the staff queue and changes belong on its own screen.
   *
   * The reference is the thing worth showing. It is what support will ask for, and it is
   * the proof the press did something — which a "thanks, we'll be in touch" does not carry.
   */
  if (state?.ok) {
    return (
      <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4">
        {/*
          Focused rather than announced through a live region. `role="status"` on a node that
          mounts already-populated is announced inconsistently across screen readers, and the
          form this replaces was the thing that had keyboard focus — so moving focus here is
          both the reliable announcement and the correct place to land.
        */}
        <h2
          ref={sentHeading}
          tabIndex={-1}
          className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em] focus-visible:outline-none"
        >
          <CheckCircle2 className="size-4 text-[var(--signal)]" aria-hidden />
          Sent to Innovatrix
        </h2>
        <p className="text-muted-foreground text-[13.5px]">
          We have it. Your reference is{" "}
          <span className="text-foreground font-mono">{state.data.reference}</span> — we will
          come back to you on this request, and you can follow it from your dashboard.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="w-fit">
            <Link href={`/dashboard/requests/${state.data.reference}` as Route}>
              Follow this request
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-fit">
            <Link href="/dashboard/requests">All your requests</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!opened) {
    return (
      <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="font-display text-[16px] tracking-[-0.02em]">Ready to send it to us?</h2>
        <p className="text-muted-foreground text-[13.5px]">
          We&rsquo;ll pull together what you&rsquo;ve told us into a summary you can check and
          change before anything is sent.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void draft()}
            disabled={drafting}
            className="w-fit"
          >
            {drafting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            Review and submit
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setLines([blank()]);
              setOpened(true);
            }}
            className="w-fit"
          >
            Write it out myself
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      id="manual-form"
      action={submit}
      className="border-border bg-surface flex flex-col gap-5 rounded-xl border p-4"
    >
      <input type="hidden" name="conversationId" value={conversationId} />

      <div>
        <h2 className="font-display text-[16px] tracking-[-0.02em]">What we understood</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Change anything that isn&rsquo;t right. Tick what you actually want — unticked lines
          are sent as things we weren&rsquo;t sure about.
        </p>
      </div>

      {draftError && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12.5px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>{draftError}</span>
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13.5px] font-medium">A short name for this</span>
        <Input
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={140}
          required
          placeholder="Rota system for a care agency"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-[13.5px] font-medium">What you need</span>

        {lines.map((line, index) => {
          const isAccepted = accepted[line.key] ?? false;
          return (
            <div
              key={line.key}
              className={
                isAccepted
                  ? "border-border bg-background flex flex-col gap-2 rounded-lg border p-3"
                  : "border-border/70 bg-surface-muted flex flex-col gap-2 rounded-lg border border-dashed p-3"
              }
            >
              <input type="hidden" name={`lines[${index}][key]`} value={line.key} />
              <input type="hidden" name={`lines[${index}][origin]`} value={line.origin} />

              <div className="flex items-start gap-2.5">
                <Checkbox
                  name={`lines[${index}][accepted]`}
                  value="on"
                  checked={isAccepted}
                  onCheckedChange={(next) =>
                    setAccepted((current) => ({ ...current, [line.key]: next === true }))
                  }
                  aria-label={`Include "${line.label}"`}
                  className="mt-1.5"
                />

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Input
                    name={`lines[${index}][label]`}
                    defaultValue={line.label}
                    maxLength={200}
                    aria-label={`Requirement ${index + 1}`}
                  />
                  <Input
                    name={`lines[${index}][detail]`}
                    defaultValue={line.detail ?? ""}
                    maxLength={600}
                    placeholder="Any specifics (optional)"
                    aria-label={`Detail for requirement ${index + 1}`}
                    className="text-[12.5px]"
                  />
                  {line.origin !== "confirmed" && (
                    <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                      {line.origin === "assumed" ? "we assumed this" : "we suggested this"}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  className="text-subtle hover:text-foreground shrink-0 p-1"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  <span className="sr-only">Remove &ldquo;{line.label}&rdquo;</span>
                </button>
              </div>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const line = blank();
            setLines((current) => [...current, line]);
            setAccepted((current) => ({ ...current, [line.key]: true }));
          }}
          className="w-fit"
        >
          <Plus className="size-3.5" aria-hidden />
          Add something
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13.5px] font-medium">Any date you&rsquo;re working to</span>
          <Input
            name="timeline"
            value={timeline}
            onChange={(event) => setTimeline(event.target.value)}
            maxLength={200}
            placeholder="Optional"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13.5px] font-medium">Anything else</span>
        <textarea
          name="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={1200}
          className="border-border bg-background w-full rounded-lg border px-3 py-2 text-[13px]"
        />
      </label>

      {state?.ok === false && (
        <p className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-[13px]">
          {state.error}
        </p>
      )}

      {signedIn ? (
        <Submit />
      ) : (
        // §17: an anonymous visitor may do the whole interview and is asked to
        // sign in only at the point of submitting. The conversation is claimed
        // on the way back, so nothing here is retyped.
        <div className="border-border bg-surface-muted flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-[13px]">
            Sign in to send this to us. Everything you&rsquo;ve written stays exactly as it is.
          </p>
          <Button asChild className="w-fit">
            <a href={signInHref}>Sign in and send</a>
          </Button>
        </div>
      )}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Send this to Innovatrix
    </Button>
  );
}

let counter = 0;
function blank(): SummaryLine {
  // Stable within the session and unique across added rows, so React keys and
  // the `accepted` map do not collide when two blanks are added in a row.
  counter += 1;
  return { key: `custom-${counter}`, label: "", origin: "confirmed" };
}
