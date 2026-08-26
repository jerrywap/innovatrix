/**
 * The assistant's suggested answers, on a channel the UI can render.
 *
 * ## Why this exists
 *
 * The interview prompt has always asked the assistant to "offer 2–4 concrete
 * options when a question has obvious common answers". It did — inside its own
 * prose, where the client cannot see them. So the customer read four options and
 * then typed one out by hand, and the only tappable chips on the page were the
 * three openers that vanished after the first turn.
 *
 * This gives those options a delimiter. The assistant ends a turn with one
 * marker line; the server splits it off before the text is shown, stored or
 * replayed as history, and the client renders the parts as chips.
 *
 * ## Yes, this parses a model's prose. Deliberately, and only here
 *
 * `extract.ts` says "never regex a model's prose" and it is right: there, a
 * missed parse writes garbage onto a request that gets quoted and built. The
 * failure mode here is the opposite and it is why this is acceptable — a marker
 * that is malformed, mid-sentence, or absent yields **no chips**, which is
 * exactly what the page did before. It can lose a suggestion. It cannot invent
 * one, and it cannot corrupt anything downstream.
 *
 * Everything below is therefore strict on purpose. The marker must be the last
 * non-empty line, or it is left alone as ordinary text.
 *
 * ## Two markers, one protocol
 *
 * `::options::` carries the tappable answers. `::covered::` carries which of the
 * discovery checklist's topics now have an answer — see
 * `features/requirements/checklist.ts` for why the model reports coverage and
 * code decides completion. Both are trailing lines, both are stripped before the
 * reply is shown or stored, and both fail the same safe way.
 *
 * They are parsed together rather than by two functions because they are the same
 * problem: a block of machine-readable lines at the end of a turn, which must be
 * recognised as a block or not at all. Parsed separately, a reply ending
 * `::options:: …\n::covered:: …` would have had its options line treated as
 * ordinary prose, because it was no longer last.
 *
 * ## It runs in three places, so it lives in `lib/`
 *
 * The prompt names the marker, the route strips it before persisting, and the
 * client strips it again while the answer is still streaming — otherwise the
 * customer watches `::options::` type itself out before it disappears. One
 * function, no `server-only`, no duplicate regex drifting out of step.
 */

/** What the assistant is told to write. Changing it means bumping `PROMPT_VERSION`. */
export const OPTIONS_MARKER = "::options::";

/** The discovery-checklist ids the assistant now has answers to. */
export const COVERED_MARKER = "::covered::";

/**
 * The assistant declaring the interview finished.
 *
 * A second, independent close signal, and it exists because of a real failure:
 * the model said "I have enough to put a brief together" while its own coverage
 * line was still one topic short, so it stopped asking questions and the page —
 * waiting on the checklist — kept the composer open with nothing to answer. An
 * interview that has stopped and a page that will not move on is worse than the
 * open-ended one this replaced.
 *
 * Code still decides completion from the checklist; this is an *or*, not an
 * override. The prompt asks for both to agree, and when they disagree the closing
 * one wins, because a brief drafted slightly early is editable and a deadlock is
 * not.
 */
export const ENOUGH_MARKER = "::enough::";

/** Every marker, so the parser can recognise a trailing block of them. */
const MARKERS = [OPTIONS_MARKER, COVERED_MARKER, ENOUGH_MARKER] as const;

/** Four is the ceiling in the prompt; parsing more would mean the model ignored it. */
const MAX_OPTIONS = 4;

/** Long enough for "Confirmations and reminders", short enough to stay a chip. */
const MAX_OPTION_LENGTH = 60;

export interface AssistantTurnText {
  /** The reply, with every marker line removed. */
  text: string;
  /** Tappable answers, in the assistant's order. Empty when there were none. */
  options: string[];
  /** The assistant says the interview is finished. See `ENOUGH_MARKER`. */
  enough: boolean;
  /**
   * Checklist ids the assistant reports having answers to.
   *
   * Not validated here — `lib/` does not know the topic vocabulary, and the route
   * drops unknown ids against `isKnownTopic` before storing them. Splitting it
   * that way keeps this module pure and keeps the vocabulary in one place.
   */
  covered: string[];
}

/**
 * Split a completed (or partially streamed) assistant turn from its markers.
 *
 * Safe to call on every streaming delta: a half-written marker is stripped from
 * the display the moment it starts appearing, which is the intent — the customer
 * must never watch `::options::` type itself out.
 *
 * Trailing marker lines are consumed as a block, in any order, so a turn ending
 * with both is handled. A line that is not a marker stops the walk: everything
 * above it is prose, whatever it looks like.
 */
export function splitAssistantOptions(raw: string): AssistantTurnText {
  const lines = raw.split("\n");

  let end = lines.length;
  let options: string[] = [];
  let covered: string[] = [];
  let enough = false;
  let found = false;

  for (;;) {
    // Walk back past trailing blanks so a model that ends with a newline still
    // has its markers recognised as final.
    let last = end - 1;
    while (last >= 0 && lines[last]!.trim() === "") last -= 1;
    if (last < 0) break;

    const candidate = lines[last]!.trim();
    const marker = MARKERS.find((name) => candidate.toLowerCase().startsWith(name));
    if (!marker) break;

    const rest = candidate.slice(marker.length);
    if (marker === OPTIONS_MARKER) options = parseOptionList(rest);
    else if (marker === COVERED_MARKER) covered = parseIdList(rest);
    else enough = true;

    found = true;
    end = last;
  }

  if (!found) return { text: raw, options: [], covered: [], enough: false };

  // A marker with nothing usable after it is still removed rather than shown.
  // The customer should never see the mechanism, working or not.
  return { text: lines.slice(0, end).join("\n").trimEnd(), options, covered, enough };
}

/**
 * A comma-separated list of checklist ids.
 *
 * Lower-cased and shape-checked only: `lib/` has no business knowing the topic
 * vocabulary, so anything that *looks* like an id survives here and the route
 * discards the ones that are not real. Capped well above the longest checklist,
 * because the cap is a runaway guard rather than a validation rule.
 */
function parseIdList(rest: string): string[] {
  const seen = new Set<string>();

  for (const part of rest.split(/[,|]/)) {
    const id = part
      .trim()
      .toLowerCase()
      .replace(/^[-*•`]+|[`.]+$/g, "");
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) continue;
    seen.add(id);
    if (seen.size === 20) break;
  }

  return [...seen];
}

/**
 * The part after the marker: pipe-separated, trimmed, deduplicated, capped.
 *
 * Deduplication is by rendered text because `conversation.tsx` keys the chips on
 * the string itself — the same reason `openers.test.ts` asserts the opener pool
 * has no duplicates.
 */
function parseOptionList(rest: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const part of rest.split("|")) {
    // Models like to bullet things even when told to use pipes.
    const option = part
      .trim()
      .replace(/^[-*•]\s*/, "")
      .trim();
    if (!option || option.length > MAX_OPTION_LENGTH) continue;
    if (seen.has(option)) continue;
    seen.add(option);
    options.push(option);
    if (options.length === MAX_OPTIONS) break;
  }

  // One option is not a choice, it is a nudge towards a single answer — and the
  // prompt asks for two to four. Treat a lone option as the model getting it
  // wrong and fall back to free text.
  return options.length >= 2 ? options : [];
}
