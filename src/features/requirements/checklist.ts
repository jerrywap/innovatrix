import type { AiContextType } from "@/lib/db/enums";
import { COVERED_MARKER, ENOUGH_MARKER } from "@/lib/assistant-options";

/**
 * What discovery is trying to find out, and therefore when it is finished.
 *
 * ## The gap this closes
 *
 * The interview had no end. The assistant asked good questions indefinitely, and
 * the only way out was a "Review what we understood" button the customer had to
 * notice and decide to press — with nothing on screen telling them whether
 * pressing it now would be premature. So the two likely outcomes were both bad:
 * press too early and the brief is mostly guesses, or keep answering until you
 * are tired of it and abandon the page.
 *
 * A conversation with no visible end is also a conversation nobody can estimate.
 * "How long is this going to take" is the first thing a busy person wants to know
 * and the page could not answer it.
 *
 * ## Why a checklist rather than letting the model decide
 *
 * The model reports **coverage**; this module decides **completion**. That split
 * is deliberate. Asking "have you got enough yet?" is asking for a judgement call
 * it has every incentive to answer eagerly, it would answer differently on
 * identical conversations, and it would be untestable. Asking "which of these
 * eight things has been answered?" is asking about the transcript in front of it,
 * and the answer is checkable.
 *
 * So `readyToClose` is ordinary code over a set of strings, and it has a test.
 *
 * ## Coverage only accumulates
 *
 * The route unions each turn's report into `coveredTopics` with `$addToSet`, so a
 * topic reported once stays covered even if a later turn forgets to mention it.
 * Progress that can go backwards is worse than no progress indicator at all, and
 * a model listing eight ids every turn will occasionally drop one.
 *
 * ## "Covered" means asked and answered, not answered the way we hoped
 *
 * A customer who says "no, nobody outside the office will use it" has answered
 * `people`. The prompt says so explicitly, because the alternative is an interview
 * that keeps circling a topic the customer has already closed — which is the
 * exhausting failure mode this whole module exists to prevent.
 */
export interface DiscoveryTopic {
  /** Stable id. The model emits these, so renaming one is a prompt change. */
  id: string;
  /** Shown to the customer in the progress list. Their words, not ours (§100). */
  label: string;
  /**
   * Required topics gate the close; the rest are welcome but never blocking.
   *
   * Kept deliberately short. Nine required topics is a questionnaire wearing a
   * conversation's clothes, and §22's point is that a person with a problem
   * should not have to complete one.
   */
  required: boolean;
}

const CUSTOM_BUILD_TOPICS: DiscoveryTopic[] = [
  { id: "problem", label: "What isn't working now", required: true },
  { id: "people", label: "Who will use it", required: true },
  { id: "today", label: "How you do it today", required: true },
  { id: "outcome", label: "What it needs to let people do", required: true },
  { id: "money", label: "Whether money changes hands", required: false },
  { id: "reporting", label: "What you need to see", required: false },
  { id: "devices", label: "Where it needs to work", required: false },
  { id: "existing", label: "What you already have", required: false },
  { id: "timing", label: "Any date you're working to", required: false },
];

const CUSTOMIZATION_TOPICS: DiscoveryTopic[] = [
  { id: "change", label: "What you'd change", required: true },
  { id: "add", label: "What's missing", required: true },
  { id: "people", label: "Who will use it", required: true },
  { id: "integrations", label: "What it needs to connect to", required: false },
  { id: "branding", label: "How it should look", required: false },
  { id: "reporting", label: "What you need to see", required: false },
  { id: "timing", label: "Any date you're working to", required: false },
];

export function topicsFor(contextType: AiContextType): DiscoveryTopic[] {
  return contextType === "customization" ? CUSTOMIZATION_TOPICS : CUSTOM_BUILD_TOPICS;
}

/** Ids the model is allowed to report. Anything else is dropped, not stored. */
export function isKnownTopic(contextType: AiContextType, id: string): boolean {
  return topicsFor(contextType).some((topic) => topic.id === id);
}

/**
 * The backstop, in customer turns.
 *
 * If the model never reports coverage — an older conversation, a provider
 * hiccup, a model that ignores the instruction — discovery must still end. Eight
 * answers is more than enough to write a brief from, and well past the point
 * where somebody wonders whether this is going anywhere.
 *
 * Deliberately not a "the assistant seems to be repeating itself" heuristic. A
 * plain count is predictable, and predictable is what a safety net needs to be.
 */
export const MAX_DISCOVERY_TURNS = 8;

export interface Coverage {
  contextType: AiContextType;
  covered: readonly string[];
  customerTurns: number;
}

/** How many required topics are answered, for the progress line. */
export function requiredProgress(input: Coverage): { done: number; total: number } {
  const required = topicsFor(input.contextType).filter((topic) => topic.required);
  const covered = new Set(input.covered);
  return {
    done: required.filter((topic) => covered.has(topic.id)).length,
    total: required.length,
  };
}

/**
 * Has discovery got what it came for?
 *
 * Two ways to be true, and the second is not a compromise — it is the guarantee
 * that the stage terminates whatever the model does.
 */
export function readyToClose(input: Coverage): boolean {
  if (input.customerTurns >= MAX_DISCOVERY_TURNS) return true;

  const progress = requiredProgress(input);
  return progress.done >= progress.total;
}

/**
 * The checklist as prompt text.
 *
 * Ids and labels together: the id is what comes back, and the label is what the
 * topic actually means. Sending only ids invites a model to guess what `outcome`
 * covers, and it guesses differently each time.
 */
export function checklistPrompt(contextType: AiContextType): string {
  const topics = topicsFor(contextType);

  return [
    "## What you are trying to find out",
    "",
    "These are the things a person needs in order to scope this. Work towards them",
    "in whatever order the conversation naturally takes — never as a list of",
    "questions, and never more than one at a time.",
    "",
    ...topics.map(
      (topic) => `- \`${topic.id}\` — ${topic.label}${topic.required ? " (needed)" : ""}`,
    ),
    "",
    "After each of your replies, add a final line listing every id you now have an",
    "answer to, cumulatively, including ones from earlier turns:",
    "",
    `${COVERED_MARKER} problem, people, today`,
    "",
    "Rules for that line:",
    "- An id is covered once the customer has **answered** it — including when the",
    '  answer is "no", "none" or "that doesn\'t apply to us". A closed question is',
    "  a covered question. Do not keep circling something they have settled.",
    "- Never list an id you worked out yourself rather than asked about.",
    "- List them all every time, not just the new ones.",
    "",
    "When every id marked (needed) is covered, say plainly that you have enough to",
    "put a brief together and stop asking questions. Do not ask for the optional",
    "ones after that point — offer them as things they can add to the brief instead.",
    "",
    `Add ${ENOUGH_MARKER} on its own line when you say that, and only then. The two must`,
    "agree: never say you have enough while an id marked (needed) is still missing",
    "from your `::covered::` line, and never keep asking questions after you have",
    "said it.",
  ].join("\n");
}
