"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Loader2, TriangleAlert } from "lucide-react";
import { Conversation, type DisplayMessage } from "./conversation";
import { ReviewPanel, blank, type Brief } from "./review-panel";
import { RequestSuccess } from "./request-success";
import { WorkspaceHeader } from "./workspace-header";
import { DiscoveryProgress } from "./discovery-progress";
import { abandonConversationAction, summariseConversationAction } from "../actions";
import { canDraftBrief, stageOf, type DiscoveryStage } from "../stage";
import { readyToClose, requiredProgress } from "../checklist";
import type { AiContextType } from "@/lib/db/enums";
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
  contextType,
  initialCovered,
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
  /** Which checklist applies. See `features/requirements/checklist.ts`. */
  contextType: AiContextType;
  /** Coverage already recorded on the conversation, so a reload does not restart it. */
  initialCovered?: string[];
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [restarting, setRestarting] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [covered, setCovered] = useState<string[]>(initialCovered ?? []);
  /**
   * Has the assistant been told to stop asking?
   *
   * Seeded from the server on load — `readyToClose` is pure, so the page and the
   * stream agree — and updated from each turn's `done` frame. Without the seed a
   * customer who reloads after the interview finished would be handed the composer
   * again by a page that had forgotten the interview was over.
   */
  const [ready, setReady] = useState(() =>
    readyToClose({
      contextType,
      covered: initialCovered ?? [],
      customerTurns: initialMessages.filter((message) => message.role === "user").length,
    }),
  );

  const customerTurns = messages.filter((message) => message.role === "user").length;
  const stage: DiscoveryStage = stageOf({
    customerTurns,
    hasBrief: brief !== null,
    submitted: Boolean(submitted),
  });

  const draft = useCallback(
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
    },
    [conversationId],
  );

  /*
   * The interview ends by itself.
   *
   * This is the whole point of the checklist. Before it, the only way out was a
   * "Review what we understood" button the customer had to notice and choose to
   * press, with nothing telling them whether it was too early — so the realistic
   * outcomes were a brief built from one sentence, or answering questions until
   * they gave up and closed the tab.
   *
   * Now the assistant reports what it has answers to, `readyToClose` decides, and
   * the page drafts the brief without being asked. Once, guarded by a ref: `ready`
   * stays true for the rest of the conversation, and this effect must not re-fire
   * and spend a second extraction every time the customer types.
   *
   * Deliberately *not* an interruption. It runs after the assistant's own closing
   * line has rendered, so the customer reads "I think I've got enough to put a
   * brief together" and then watches that happen — rather than having the
   * conversation yanked away mid-sentence. And the conversation is still there,
   * collapsed in the review rail, if they want to add something.
   */
  const autoDrafted = useRef(false);
  useEffect(() => {
    if (!ready || brief || drafting || autoDrafted.current) return;
    autoDrafted.current = true;
    void draft();
  }, [brief, draft, drafting, ready]);

  const onCoverage = useCallback(
    ({ covered: next, ready: done }: { covered: string[]; ready: boolean }) => {
      // The server sends the accumulated set, so this is a replace rather than a
      // union — `recordCoverage` has already done the accumulating.
      setCovered(next);
      if (done) setReady(true);
    },
    [],
  );

  const progress = requiredProgress({ contextType, covered, customerTurns });

  const startOver = (
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
      className="text-subtle hover:text-foreground flex shrink-0 items-center gap-1.5 text-[12px]"
    >
      <RotateCcw className="size-3.5" aria-hidden />
      Start over
    </button>
  );

  /*
   * Every hook is above this line, and that is not tidiness.
   *
   * The early returns below are the four stages, so a submitted conversation
   * renders a different branch from an active one — and a hook declared after a
   * return is called on one render and skipped on the next, which is the
   * rules-of-hooks violation React breaks on rather than warns about. Written the
   * other way round first; lint caught it.
   */

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

  /* ── C: the brief is the page ───────────────────────────── */

  if (brief) {
    return (
      <div className="flex flex-col gap-8">
        <WorkspaceHeader title={workspaceTitle} stage={stage} action={startOver} />

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

          <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:col-span-4 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">
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
                  /*
                   * The live transcript, not the one the page was rendered with.
                   *
                   * This instance really does mount fresh — the review stage moves
                   * the conversation into a disclosure in the rail — and
                   * `Conversation` seeds its state from this prop once. Passing the
                   * server's original list would have shown whatever was there when
                   * the page loaded and silently dropped every turn since, which on
                   * the usual path is the entire interview.
                   */
                  initialMessages={messages}
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
    <div className="flex flex-col gap-4">
      <Conversation
        conversationId={conversationId}
        initialMessages={initialMessages}
        onTranscriptChange={setMessages}
        onCoverage={onCoverage}
        onFallback={() => setBrief({ title: "", lines: [blank()], timeline: "", manual: true })}
        {...(suggestions ? { suggestions } : {})}
        {...(initialDraft ? { initialDraft } : {})}
      />

      {drafting ? (
        /*
          The auto-close, made visible.

          Something has to occupy the moment between the assistant saying it has
          enough and the brief appearing, or the page looks like it has stopped
          responding at the one point the customer is waiting on it.
        */
        <p className="text-subtle flex items-center gap-2 text-[12.5px]">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Putting your brief together…
        </p>
      ) : (
        stage === "discovery" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/*
              How far through, in plain numbers.

              "How long is this going to take" is the first thing a busy person
              wants to know, and the page could not answer it — which is half of
              why an open-ended interview is exhausting. Only the required topics
              are counted, so the number cannot stall on optional ones.
            */}
            <p className="text-subtle text-[12px]">
              {progress.done === 0
                ? `A few questions — usually ${progress.total} or so.`
                : `${progress.done} of ${progress.total} things understood.`}
            </p>

            {/*
              The manual way in, now demoted to a link.

              It used to be the only exit and a full card with a primary button.
              With the interview closing itself it is the escape hatch for somebody
              who has said enough and does not want to be asked the rest — worth
              keeping, not worth competing with the conversation.

              Still gated on two answers. Drafting from one sentence produces a
              brief that is mostly the model's guesses, and every guess is a line
              the customer then has to read and decline — so the shortcut only
              appears once there is something to shorten.
            */}
            {canDraftBrief(customerTurns) && (
              <button
                type="button"
                onClick={() => void draft()}
                className="text-subtle hover:text-foreground text-[12px] underline underline-offset-4"
              >
                Skip ahead and review what we understood
              </button>
            )}
          </div>
        )
      )}
    </div>
  );

  /*
   * One tree for the invitation and the workspace, and this is load-bearing.
   *
   * These were two branches: at the invitation `conversation` sat in a bare
   * fragment, and at discovery it sat inside `div.grid > div.col-span-8`. Sending
   * the first message flips the stage, which changed `Conversation`'s parent chain
   * — so React unmounted and remounted it, and `useState(initialMessages)` ran
   * again.
   *
   * The result was the bug: the customer's message disappeared the instant it was
   * sent, `busy` reset to `false` so the next click fired a *second* request, and
   * the replies resolved into a component that no longer existed. Nothing appeared
   * until a refresh, at which point every click they had made was in the
   * transcript, because every one of them had reached the server.
   *
   * So the structure is now fixed and only classes and sibling slots change.
   * Toggling a slot between an element and `null` is safe — React keeps each JSX
   * expression at its own index — but moving a stateful component between parents
   * is not.
   */
  return (
    <div className="flex flex-col gap-8">
      {stage === "invitation" ? (
        /* The progress row belongs here too, so "one of three" is visible before
           you commit rather than only after. No "start over" — there is nothing
           yet to start over from, which is why it used to sit at the very bottom
           of the page looking like an afterthought. */
        <DiscoveryProgress stage={stage} />
      ) : (
        <WorkspaceHeader title={workspaceTitle} stage={stage} action={startOver} />
      )}

      {/*
        The grid is unconditional. It used to appear only once the conversation had
        started, so on `/customize` — where the visitor lands before saying
        anything — the listing panel spent that whole time stacked underneath the
        chat instead of beside it.
      */}
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className={aside ? "lg:col-span-8" : "lg:col-span-12"}>
          <div className="flex flex-col gap-8">
            {stage === "invitation" ? intro : null}
            {conversation}
            {stage === "invitation" ? introFooter : null}
          </div>
        </div>

        {aside ? (
          /*
            Pinned, and scrollable on its own if it is taller than the viewport.
            The listing panel is what the customer is reacting to — a page that
            scrolled it away while they typed about it was asking them to remember
            what they had just read.
          */
          <div className="lg:sticky lg:top-24 lg:col-span-4 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">
            {aside}
          </div>
        ) : null}
      </div>
    </div>
  );
}
