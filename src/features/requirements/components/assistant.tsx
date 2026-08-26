"use client";

import { useState } from "react";
import { RotateCcw, Sparkles, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Conversation, type DisplayMessage } from "./conversation";
import { ReviewPanel, blank, type Brief } from "./review-panel";
import { RequestSuccess } from "./request-success";
import { WorkspaceHeader } from "./workspace-header";
import { DiscoveryProgress } from "./discovery-progress";
import { abandonConversationAction, summariseConversationAction } from "../actions";
import { canDraftBrief, stageOf, type DiscoveryStage } from "../stage";
import type { RequestStatus } from "@/lib/db/enums";

/**
 * The four states of a discovery page — tickets 17 and 18.
 *
 * Both doors render this. What differs is the system prompt and the entry point;
 * the machinery of talking, summarising, editing and submitting is one
 * implementation, because §73's guardrails and §34's confirmed-vs-assumed split
 * must not have two versions that can disagree.
 *
 * ## Why this owns the stage
 *
 * `stageOf` needs three facts and they live in three places: the transcript is
 * here, the drafted brief is here, and whether the conversation has already been
 * submitted is the server's. So the page hands the third one down and this decides
 * — one decision, read by the progress row, the intro, the layout and the
 * conversation's own placement. When those were four separate conditions they were
 * four chances to differ, and did: the review panel was gated on one customer
 * message under a comment claiming two.
 *
 * ## The chrome arrives as elements, not components
 *
 * `intro` and `aside` are server-rendered JSX passed in as props. React elements
 * serialise across the RSC boundary; component *functions* do not, and passing one
 * takes the whole shell down with a 500 — see `components/shell/nav-icons.ts`. So
 * the marketing copy and the product panel stay server components while the stage
 * that decides whether to show them is client state.
 */
export function Assistant({
  conversationId,
  initialMessages,
  signedIn,
  signInHref,
  suggestions,
  initialDraft,
  startOverHref,
  submitted,
  workspaceTitle,
  intro,
  introFooter,
  aside,
}: {
  conversationId: string;
  initialMessages: DisplayMessage[];
  signedIn: boolean;
  signInHref: string;
  suggestions?: string[];
  /** Prefills the first message from elsewhere — see `Conversation`. */
  initialDraft?: string;
  startOverHref: string;
  /** Already a request. The page resolves the reference so this can show it. */
  submitted?: { reference: string; submittedAt?: string; status: RequestStatus };
  /** Shown once the intro has collapsed. "Custom software request", or similar. */
  workspaceTitle: string;
  /** The invitation. Rendered at stage A only, and dropped from the tree after. */
  intro?: React.ReactNode;
  /**
   * The rest of the invitation, below the composer.
   *
   * Two props rather than one prop with `children`, because the intro is a
   * *server* element and cannot be handed a client island to render inside
   * itself. The split is what puts the box to type in between the pitch and the
   * process, where somebody who has just read "in your own words" is already
   * looking.
   */
  introFooter?: React.ReactNode;
  /** Context that stays useful throughout — the listing panel on `/customize`. */
  aside?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [restarting, setRestarting] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const customerTurns = messages.filter((message) => message.role === "user").length;
  const stage: DiscoveryStage = stageOf({
    customerTurns,
    hasBrief: brief !== null,
    submitted: Boolean(submitted),
  });

  /* ── D: it is already a request ─────────────────────────── */

  if (submitted) {
    return (
      <RequestSuccess
        reference={submitted.reference}
        {...(submitted.submittedAt ? { submittedAt: submitted.submittedAt } : {})}
        status={submitted.status}
      />
    );
  }

  async function draft() {
    setDrafting(true);
    setDraftError(null);

    const result = await summariseConversationAction(conversationId);
    setDrafting(false);

    if (!result.ok) {
      /*
       * §104: a failed draft is a path, not an error.
       *
       * The customer lands in the same editor with one empty line and writes it
       * out themselves. Everything they said is still in the transcript, and the
       * message says so — being told "we couldn't summarise that" while the
       * conversation is visibly still there is very different from losing it.
       */
      setDraftError(result.error);
      setBrief({ title: "", lines: [blank()], timeline: "", manual: true });
      return;
    }

    setBrief({
      title: result.data.title,
      lines: result.data.lines,
      timeline: result.data.timeline ?? "",
      manual: false,
    });
  }

  /* ── C: the brief is the page ───────────────────────────── */

  if (brief) {
    return (
      <div className="flex flex-col gap-8">
        <WorkspaceHeader title={workspaceTitle} stage={stage} />

        {draftError && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <span>{draftError}</span>
          </p>
        )}

        {/*
          §28 — two columns, so the review stage stops being one enormous vertical
          form. The brief is the content; the rail holds what you might want to
          check against it. Below `lg` it is one column with the rail *after* the
          brief, which is the right order on a phone: the document first, its
          references second.
        */}
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-8">
            <ReviewPanel
              conversationId={conversationId}
              signedIn={signedIn}
              signInHref={signInHref}
              brief={brief}
              onBriefChange={setBrief}
            />
          </div>

          <div className="flex flex-col gap-5 lg:col-span-4">
            {aside}

            {/*
              §27 — the conversation has done its job, so it collapses.

              Still mounted, deliberately: `<details>` hides its children rather
              than unmounting them, so the transcript, the streaming state and the
              composer are all exactly where they were if the customer opens it.
              Dumping forty messages above the brief was what made this stage a
              page nobody could find the end of.
            */}
            <details className="border-border bg-surface group rounded-2xl border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-[13px] font-medium">
                Discovery conversation
                <span className="text-subtle text-[12px] underline underline-offset-4">
                  <span className="group-open:hidden">View</span>
                  <span className="hidden group-open:inline">Hide</span>
                </span>
              </summary>
              <div className="border-border border-t p-4">
                <Conversation
                  conversationId={conversationId}
                  initialMessages={initialMessages}
                  onTranscriptChange={setMessages}
                  {...(initialDraft ? { initialDraft } : {})}
                />
              </div>
            </details>
          </div>
        </div>
      </div>
    );
  }

  /* ── A and B: invitation, then workspace ────────────────── */

  const conversation = (
    <div className="flex flex-col gap-6">
      <Conversation
        conversationId={conversationId}
        initialMessages={initialMessages}
        onTranscriptChange={setMessages}
        onFallback={() => setBrief({ title: "", lines: [blank()], timeline: "", manual: true })}
        {...(suggestions ? { suggestions } : {})}
        {...(initialDraft ? { initialDraft } : {})}
      />

      {canDraftBrief(customerTurns) && (
        /*
          The bridge from B to C, and the only way into the brief.
          
          It waits for two customer turns rather than one — see
          `TURNS_BEFORE_REVIEW`. Offering to summarise a single sentence produces a
          brief that is mostly the model's guesses, each of which is a line
          somebody then has to read and decline.
        */
        <div className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4">
          <p className="text-[13.5px] font-medium">Ready to see what we understood?</p>
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            We&rsquo;ll turn this conversation into a brief you can correct before anything is
            sent. You can keep talking instead &mdash; whichever is more use.
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
              Review what we understood
            </Button>
            <button
              type="button"
              onClick={() =>
                setBrief({ title: "", lines: [blank()], timeline: "", manual: true })
              }
              className="text-subtle hover:text-foreground text-[12.5px] underline underline-offset-4"
            >
              Write it out myself
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {stage === "invitation" ? (
        <>
          {/* The progress row belongs here too, so "one of three" is visible
              before you commit rather than only after. */}
          <DiscoveryProgress stage={stage} />
          {intro}
          {conversation}
          {aside}
          {introFooter}
        </>
      ) : (
        <>
          <WorkspaceHeader title={workspaceTitle} stage={stage} />
          <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
            <div className={aside ? "lg:col-span-8" : "lg:col-span-12"}>{conversation}</div>
            {aside && <div className="lg:col-span-4">{aside}</div>}
          </div>
        </>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={restarting}
          onClick={async () => {
            setRestarting(true);
            await abandonConversationAction(conversationId);
            // A full navigation: the page starts a fresh conversation server-side,
            // and the abandoned one stays on record (§19) rather than vanishing.
            window.location.href = startOverHref;
          }}
          className="text-subtle hover:text-foreground flex items-center gap-1.5 text-[12.5px]"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Start over
        </button>
      </div>
    </div>
  );
}
