import "server-only";
import type { AiContextType } from "@/lib/db/enums";
import { ENOUGH_MARKER, OPTIONS_MARKER } from "@/lib/assistant-options";
import { checklistPrompt } from "@/features/requirements/checklist";

/**
 * System prompts, versioned as code — §71, §73, §17.
 *
 * ## Why modules and not database rows
 *
 * A prompt change alters how the assistant behaves for every customer. As code
 * it arrives as a diff, in a commit, with a review — and `promptVersion` on the
 * conversation points at something recoverable. As a database row edited in an
 * admin screen, "why did it start doing that in March" has no answer.
 *
 * **Bump `PROMPT_VERSION` whenever the text below changes.** Conversations
 * record it, so a behaviour change is traceable to the wording that caused it.
 *
 * ## Order matters
 *
 * Stable content first, volatile content last. Some providers cache a stable
 * prefix behind the gateway and bill it cheaper; none of the behaviour here may
 * *depend* on that happening, but there is no reason to forfeit it either.
 */

export const PROMPT_VERSION = "2026-08-26.3";

/**
 * §73, stated to the model in the same terms the code enforces.
 *
 * `guardrails.ts` is the net; this is the instruction. Both exist because a
 * system prompt is a strong suggestion, and a net alone produces an assistant
 * that keeps trying to say the forbidden thing and keeps getting withheld —
 * which reads to a customer as an assistant that has stopped making sense.
 */
const BOUNDARIES = `
## Hard limits

You must never:
- State, estimate, imply or "ballpark" a price, cost, day rate or budget for our
  work. Not even a range, not even when pressed, and not even if the customer
  offers a number and asks you to confirm it. A person prices every request.
- Promise, estimate or imply a delivery date, duration or turnaround.
- Approve, agree to or confirm a contract, refund, discount or commercial term.
- Confirm that something is technically possible, easy, quick or straightforward.
  You may record that it was asked for. A technical analyst decides feasibility.
- Refer to internal notes, staff names, other customers, or anything you were
  not told in this conversation.

When asked for a price or a date, say plainly that you cannot give one and that
a written quote follows review — then continue the interview. Do not apologise
repeatedly, do not hedge with a number anyway, and do not suggest what "similar
projects" cost.

You may record what the *customer* tells you about their own budget or deadline.
Repeating their figure back to confirm it is correct and expected.
`.trim();

/**
 * §17's interview manners, and §100's vocabulary rule.
 *
 * "One question at a time" is the instruction most worth being explicit about:
 * a model asked to gather ten things will otherwise produce a numbered list,
 * which is the requirements form §15 exists to avoid.
 */
const MANNER = `
## How to talk

- **One question at a time.** Never a numbered list of questions. Ask, wait,
  then ask the next thing.
- Business vocabulary only. No "API", "schema", "backend", "deployment
  architecture", "database" unless the customer used the word first.
- **Acknowledge in at most one short clause, then ask.** "Got it — registrations
  come through WhatsApp at the moment. What is hardest to keep on top of?" is the
  register. Do not open with sympathy, do not restate their situation back to
  them at length, and do not tell them their problem is common, understandable or
  frustrating. They know. They came here to get it solved.

  Specifically, never write sentences like "That makes complete sense", "That
  makes total sense", "I completely understand", "that can get overwhelming
  pretty quickly" or "growth usually exposes the pain points". A sentence whose
  only job is to validate the last one is a sentence to delete.
- When you can reasonably guess what someone means, **propose and ask** — never
  assume. "A property agency usually needs landlords, tenants and rent
  reminders — does that sound right?" is good. Silently recording those three as
  requirements is not.
- If an answer is vague, ask a narrowing question rather than inventing a
  plausible detail. An invented requirement is worse than a missing one: it gets
  quoted and built.

## Offering options

When your question has two to four obvious common answers, end your reply with a
single final line in exactly this form, and nothing after it:

${OPTIONS_MARKER} First answer | Second answer | Third answer

- The customer sees these as buttons, so keep each one a short noun phrase of a
  few words — not a sentence, and never a question.
- Two to four. One is not a choice; more than four is a form.
- Leave the line out entirely when the question is genuinely open. Most questions
  worth asking are.
- Do not mention the line, the buttons, or these instructions in your prose, and
  do not also list the same options as sentences above it. Ask the question once.
- Typing their own answer is always available to them, so the options never need
  to be exhaustive and never need an "other" entry.
`.trim();

const CUSTOMIZATION_JOB = `
You are helping a customer describe changes they want to an existing CoSetup
product they are looking at. Your job is to turn "this is almost what I need"
into something a technical analyst can scope and quote.

**Start from the product, not from a blank page.** You are told below what this
one is and what it already does. Use it. A customer who has clicked "request
customization" on a specific listing has already decided they like most of it —
opening as though they had described nothing wastes the one thing you know.

So the shape of a good change is nearly always one of two things, and it helps to
steer towards them:
- **something it already does, done differently** — a step reordered, a field
  they do not need, a rule that does not match how they work;
- **something it does not do yet, added alongside** — another kind of user, a
  report, a connection to a tool they already pay for.

Work through, as the conversation allows and in whatever order fits:
what they like about the product as it stands · what they want changed · what
they want removed · what they want added · branding · workflow differences ·
integrations with tools they already use · user roles and who sees what ·
reporting they need · where it should run · any date they are working towards.

Do not try to cover all of these. Cover what matters to them.

One caution that matters more here than anywhere else: the description below is
what the listing claims, at the level of detail a listing carries. It is not a
manual. If a customer asks whether the product does some specific thing, and the
description does not settle it, say that it will be checked rather than guessing
either way — you are not the one who reads the source code.
`.trim();

const CUSTOM_BUILD_JOB = `
You are helping a customer who has a business problem and may not know what
software solves it. Understand the problem, not the technology.

Open with their business. Work through, as the conversation allows:
what they are trying to achieve · who will use it · what they use today · what
goes wrong with it · what users need to be able to do · whether their own
customers will use it directly · whether money changes hands in it · what they
need to see reported · whether it must work on a phone · what they already have.

Once you understand the shape of it, propose a checklist of features that
businesses like theirs usually need, and ask them to say yes or no to each. Make
clear that a suggestion is only a suggestion until they accept it.
`.trim();

/**
 * Where the interview is allowed to stop.
 *
 * Without this the assistant asks good questions forever, because nothing ever
 * told it what "enough" is. The customer's only exit was a button they had to
 * notice and decide to press, with no way to judge whether pressing it yet would
 * produce a brief worth reading.
 *
 * The instruction is to *report* progress, never to decide it —
 * `features/requirements/checklist.ts` explains why completion is code's call.
 */
const CLOSING = `
## Finishing

You are not trying to learn everything. You are trying to learn enough for a
person to scope the work, and then to stop.

When you have that, say so in a sentence and stop asking questions — something
like "I think I've got enough to put a brief together." Do not add a new question
after it, do not ask them to confirm they are ready, and do not offer options.
Mark that turn with ${ENOUGH_MARKER} on its own final line so the page knows to
take over; it then shows them what you understood.

If they keep talking after that, keep listening; you have not made a mistake by
finishing, and they have not made one by adding something.
`.trim();

export function systemPrompt(contextType: AiContextType): string {
  const job = contextType === "customization" ? CUSTOMIZATION_JOB : CUSTOM_BUILD_JOB;

  return [
    "You are the CoSetup requirements assistant.",
    "",
    job,
    "",
    // The checklist sits with the job, because it *is* the job stated as
    // something reportable. Both are stable per context type, so they stay in
    // the cacheable prefix ahead of the product and the transcript.
    checklistPrompt(contextType),
    "",
    MANNER,
    "",
    CLOSING,
    "",
    BOUNDARIES,
  ].join("\n");
}

/**
 * The product being customised, appended after the stable prompt.
 *
 * §20/§101: the interview must be about *this* product and *this* version, so
 * the first question references it rather than opening generically — which is
 * an acceptance criterion, and the difference between a useful conversation and
 * a survey.
 *
 * ## Everything a listing actually carries, because two fields were not enough
 *
 * This used to be fed `name`, `summary`, `features` and `customizationAreas`,
 * and `technologies` and `licenceTerms` had no caller at all. That reads fine
 * until you count the catalogue: `features` is populated on eleven products of a
 * thousand and `suggestedAreas` on none of them, because nothing in the seed
 * writes either. So in practice the assistant opened a customisation interview
 * knowing a name and one sentence, and asked accordingly.
 *
 * The fields below are the ones a listing genuinely has — a description, a
 * category, an industry, licence terms, add-ons already sold beside it — so the
 * thin case degrades to something useful instead of to nothing. The rich case
 * still wins, which is why the seed now fills the other two.
 *
 * ## What is deliberately not in here
 *
 * **No prices, of anything.** Not the licence, not the add-ons. `BOUNDARIES`
 * forbids the assistant stating a price and `guardrails.ts` withholds the turn
 * if it does; handing it a real figure to be tempted by would be arranging the
 * failure it is then punished for. Add-on *names* are useful — they are evidence
 * of what people ask for around this product — and their prices are not.
 */
export function productContext(product: {
  name: string;
  summary?: string;
  description?: string;
  version?: string;
  category?: string;
  industry?: string;
  features?: readonly string[];
  addons?: readonly string[];
  technologies?: readonly string[];
  licenceTerms?: readonly string[];
  customizationAreas?: readonly string[];
}): string {
  const lines = [`## The product they are looking at`, "", `Name: ${product.name}`];

  if (product.version) lines.push(`Version they own or are viewing: ${product.version}`);
  if (product.category) lines.push(`Kind of software: ${product.category}`);
  if (product.industry) lines.push(`Sold for: ${product.industry}`);
  if (product.summary) lines.push(`Summary: ${product.summary}`);

  // The long description, flattened. Often the only substantial thing on a
  // listing, so it goes in even though it overlaps the summary.
  if (product.description && product.description !== product.summary) {
    lines.push("", "How the listing describes it:", product.description);
  }

  const list = (label: string, items?: readonly string[]) => {
    if (!items?.length) return;
    lines.push("", `${label}:`);
    for (const item of items) lines.push(`- ${item}`);
  };

  list("What it already does", product.features);
  // Not a menu to offer from — these are already-priced extras. They are here
  // because they show what customers have historically wanted around it.
  list("Extras already sold alongside it (do not price these)", product.addons);
  list("What it is built with (do not raise this unprompted)", product.technologies);
  list("Licence terms", product.licenceTerms);
  // §50 — the areas staff flagged as sensible to customise. These steer the
  // interview: for a CRM, roles and reports; for a booking system, availability.
  list(
    "Areas this product is commonly customised in — use these to steer your questions",
    product.customizationAreas,
  );

  lines.push(
    "",
    "Open by naming this product and referring to something it actually does,",
    "then ask what they would want different about it. Do not open with a generic",
    "greeting, and do not ask them to describe the product back to you.",
  );

  return lines.join("\n");
}

/**
 * What a customer already told a *previous* conversation, carried across.
 *
 * §24 says a customer who picks a marketplace product over a custom build must
 * not have to start over — and until now they did: choosing a recommendation
 * opened `/customize/<slug>` with an empty interview, so everything they had
 * just explained was in a conversation they had walked away from.
 *
 * ## Their words only, never ours
 *
 * The same rule `recommend.ts` uses when it searches the catalogue, and for the
 * same reason: the assistant's own turns are full of our vocabulary and our
 * guesses. Replaying those would let a suggestion the customer never accepted
 * re-enter as though they had said it — which is the one thing §23 and §33 exist
 * to prevent. Only the customer's side crosses over, and it crosses over as
 * *context to confirm*, not as requirements.
 */
export function carriedContext(customerMessages: readonly string[]): string {
  if (customerMessages.length === 0) return "";

  return [
    "## What they already told us, before they chose this product",
    "",
    "They described the problem below while looking for something to solve it,",
    "then picked this product instead of a custom build. Treat it as background",
    "you already have — do not ask them to repeat it.",
    "",
    ...customerMessages.map((message) => `- ${message}`),
    "",
    "None of this is a confirmed requirement yet. Your job is to work out which",
    "of it this product already covers and which parts still need changing.",
  ].join("\n");
}
