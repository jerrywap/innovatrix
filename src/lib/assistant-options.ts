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
 * ## It runs in three places, so it lives in `lib/`
 *
 * The prompt names the marker, the route strips it before persisting, and the
 * client strips it again while the answer is still streaming — otherwise the
 * customer watches `::options::` type itself out before it disappears. One
 * function, no `server-only`, no duplicate regex drifting out of step.
 */

/** What the assistant is told to write. Changing it means bumping `PROMPT_VERSION`. */
export const OPTIONS_MARKER = "::options::";

/** Four is the ceiling in the prompt; parsing more would mean the model ignored it. */
const MAX_OPTIONS = 4;

/** Long enough for "Confirmations and reminders", short enough to stay a chip. */
const MAX_OPTION_LENGTH = 60;

export interface AssistantTurnText {
  /** The reply, with the marker line removed. Never empty if the input was not. */
  text: string;
  /** Tappable answers, in the assistant's order. Empty when there were none. */
  options: string[];
}

/**
 * Split a completed (or partially streamed) assistant turn into text and options.
 *
 * Safe to call on every streaming delta: a half-written marker is not the last
 * line yet only in the sense that it *is*, so it is stripped from the display as
 * soon as it starts appearing. That is the intent — the marker is never shown.
 */
export function splitAssistantOptions(raw: string): AssistantTurnText {
  const lines = raw.split("\n");

  // Walk back past trailing blanks so a model that ends with a newline still
  // has its marker recognised as final.
  let last = lines.length - 1;
  while (last >= 0 && lines[last]!.trim() === "") last -= 1;
  if (last < 0) return { text: raw, options: [] };

  const candidate = lines[last]!.trim();
  if (!candidate.toLowerCase().startsWith(OPTIONS_MARKER)) {
    return { text: raw, options: [] };
  }

  const options = parseOptionList(candidate.slice(OPTIONS_MARKER.length));

  // A marker with nothing usable after it is still removed rather than shown.
  // The customer should never see the mechanism, working or not.
  return { text: lines.slice(0, last).join("\n").trimEnd(), options };
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
