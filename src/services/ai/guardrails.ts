/**
 * §73, enforced in code as well as in the prompt.
 *
 * The prompt tells the assistant not to quote prices or promise dates. This
 * checks whether it listened. Both are needed: a system prompt is a strong
 * suggestion, and "the model was told not to" is not a defence when a customer
 * screenshots a number and treats it as an offer.
 *
 * ## The naive version of this check is wrong
 *
 * Flagging any currency amount in assistant output breaks the ordinary case:
 * a customer says "my budget is about £5,000", and the assistant reflecting
 * that back — "noted, around £5,000" — is good interviewing, not a quote. A
 * detector that trips on it withholds a correct turn and teaches everyone to
 * ignore the flag.
 *
 * So the rule is **an amount the customer did not introduce**. Numbers echoed
 * from the conversation are allowed; numbers invented by the assistant are not.
 * Dates get the same treatment for the same reason: "we'll build it by March"
 * is a promise, and "you mentioned March" is not.
 *
 * Pure and dependency-free so it can be unit-tested exhaustively, which for a
 * rule like this is the whole point.
 */

export type GuardrailReason = "quoted_a_price" | "promised_a_date";

export interface GuardrailVerdict {
  ok: boolean;
  reason?: GuardrailReason;
  /** What tripped it, for the staff-facing record. Never shown to a customer. */
  matched?: string;
}

/* ────────────────────────────────────────────── amounts */

/**
 * Currency-looking amounts: a symbol or code with digits, either order.
 *
 * Deliberately does **not** match bare numbers. "20 users" and "3 branches" are
 * the substance of a requirements interview, and treating every integer as a
 * possible price would flag almost every useful turn.
 */
const AMOUNT = /(?:[£$€₦]\s?\d[\d,]*(?:\.\d+)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:GBP|USD|EUR|NGN))/gi;

/** `£1,200.00` → `1200` — so £1,200 and £1200 compare equal. */
function normaliseAmount(text: string): string {
  const digits = /\d[\d,]*(?:\.\d+)?/.exec(text)?.[0] ?? "";
  const value = Number(digits.replace(/,/g, ""));
  return Number.isFinite(value) ? String(value) : digits;
}

/**
 * The hole that "allow amounts the customer introduced" leaves open.
 *
 * Found by pushing the live assistant three ways: *"my colleague was told
 * £4,000 for something like this — can you confirm that's about right?"* The
 * number is now the customer's, so provenance alone permits the assistant to
 * reply *"yes, £4,000 is about right"* — which is a quote, delivered by
 * agreeing with one rather than stating one.
 *
 * So an echoed amount is allowed when the assistant is **recording** it and not
 * when it is **endorsing** it. The signal is affirmation-of-correctness in the
 * same sentence: "that's about right", "roughly accurate", "in the ballpark".
 *
 * Questions are exempt, because "your budget is £5,000 — is that right?" is the
 * assistant checking it understood, which is the opposite failure.
 */
const ENDORSEMENT =
  /\b(?:about right|roughly right|sounds right|that'?s right|pretty accurate|roughly accurate|fairly accurate|accurate|realistic|reasonable|in the (?:right )?(?:range|ballpark)|in that (?:range|ballpark)|ballpark|in line with|comparable|typical for|about what)\b/i;

/** Crude but sufficient: the amount and the endorsement must share a sentence. */
function sentencesWith(text: string, pattern: RegExp): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((sentence) => pattern.test(sentence));
}

/* ────────────────────────────────────────────── dates */

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";

/**
 * A **commitment**, not a date.
 *
 * "When do you need it?" contains no promise. "We'll deliver by March" does.
 * The distinction is the verb, so the pattern requires a delivery verb near the
 * time expression rather than matching times on their own.
 */
const DATE_COMMITMENT = new RegExp(
  String.raw`\b(?:we(?:'| w)?ll|we can|we will|i(?:'| w)?ll|it will be|expect it|ready|delivered?|deliver|complete[d]?|launch(?:ed)?|live|done|turn(?:ed)? around|ship(?:ped)?)\b[^.!?]{0,60}?` +
    String.raw`\b(?:by|within|in|before|on|takes?|take)\b\s*` +
    String.raw`(?:\d+\s*(?:days?|weeks?|months?|working days?|business days?)|(?:${MONTHS})|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:next|this)\s+(?:week|month|quarter))`,
  "i",
);

/** The reverse order: "two weeks to deliver", "a month to build". */
const DURATION_COMMITMENT = new RegExp(
  String.raw`\b(?:\d+|a|one|two|three|four|five|six)\s*(?:days?|weeks?|months?)\b[^.!?]{0,30}?` +
    String.raw`\b(?:to (?:build|deliver|complete|develop|finish)|turnaround|delivery|lead time)\b`,
  "i",
);

/* ────────────────────────────────────────────── the check */

/**
 * Does this assistant turn cross a §73 line, given what the customer has said?
 *
 * `customerText` is every customer message so far, concatenated. An amount is
 * allowed only if the same number appears there.
 */
export function checkAssistantTurn(reply: string, customerText: string): GuardrailVerdict {
  const known = new Set(
    (customerText.match(AMOUNT) ?? []).map(normaliseAmount).filter(Boolean),
  );

  for (const found of reply.match(AMOUNT) ?? []) {
    if (!known.has(normaliseAmount(found))) {
      return { ok: false, reason: "quoted_a_price", matched: found.trim() };
    }
  }

  // Echoed amounts are fine to record and not to endorse. A statement that
  // agrees a figure is right is a quote however the figure got into the room.
  for (const sentence of sentencesWith(reply, AMOUNT)) {
    if (sentence.trimEnd().endsWith("?")) continue;
    const endorsement = ENDORSEMENT.exec(sentence);
    if (endorsement) {
      return { ok: false, reason: "quoted_a_price", matched: sentence.trim() };
    }
  }

  const commitment = DATE_COMMITMENT.exec(reply) ?? DURATION_COMMITMENT.exec(reply);
  if (commitment) {
    return { ok: false, reason: "promised_a_date", matched: commitment[0].trim() };
  }

  return { ok: true };
}

/**
 * What the customer sees instead of a withheld turn.
 *
 * Not an error and not silence. §17 wants the assistant to stay useful, so this
 * explains the boundary and hands the conversation back rather than stopping
 * it — and it is the same answer whether the model quoted £500 or £50,000, so
 * nothing leaks through the shape of the refusal.
 */
export const GUARDRAIL_REPLIES: Record<GuardrailReason, string> = {
  quoted_a_price:
    "I can't put a price on this — a person reviews every request and sends a " +
    "written quote, so that any figure you get is one we'll stand behind. " +
    "Let's keep going with what you need, and pricing follows from that. " +
    "What else should the system do?",
  promised_a_date:
    "I can't commit to a timeline — that comes with the quote, once someone has " +
    "looked at the scope properly. I can record what you're working towards, " +
    "though. Is there a date this needs to be usable by?",
};
