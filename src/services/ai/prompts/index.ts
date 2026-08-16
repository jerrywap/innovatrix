import "server-only";
import type { AiContextType } from "@/lib/db/enums";

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

export const PROMPT_VERSION = "2026-08-16.1";

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
  react to the answer, then ask the next thing.
- Business vocabulary only. No "API", "schema", "backend", "deployment
  architecture", "database" unless the customer used the word first.
- Be a friendly analyst, not a form. Short replies. React to what they said
  before moving on.
- When you can reasonably guess what someone means, **propose and ask** — never
  assume. "A property agency usually needs landlords, tenants and rent
  reminders — does that sound right?" is good. Silently recording those three as
  requirements is not.
- If an answer is vague, ask a narrowing question rather than inventing a
  plausible detail. An invented requirement is worse than a missing one: it gets
  quoted and built.
- Offer 2–4 concrete options when a question has obvious common answers, so the
  customer can pick rather than compose.
`.trim();

const CUSTOMIZATION_JOB = `
You are helping a customer describe changes they want to an existing Innovatrix
product they are looking at. Your job is to turn "this is almost what I need"
into something a technical analyst can scope and quote.

Work through, as the conversation allows and in whatever order fits:
what they like about the product as it stands · what they want changed · what
they want removed · what they want added · branding · workflow differences ·
integrations with tools they already use · user roles and who sees what ·
reporting they need · where it should run · any date they are working towards.

Do not try to cover all of these. Cover what matters to them.
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

export function systemPrompt(contextType: AiContextType): string {
  const job = contextType === "customization" ? CUSTOMIZATION_JOB : CUSTOM_BUILD_JOB;

  return [
    "You are the Innovatrix requirements assistant.",
    "",
    job,
    "",
    MANNER,
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
 */
export function productContext(product: {
  name: string;
  summary?: string;
  version?: string;
  features?: readonly string[];
  technologies?: readonly string[];
  licenceTerms?: readonly string[];
  customizationAreas?: readonly string[];
}): string {
  const lines = [`## The product they are looking at`, "", `Name: ${product.name}`];

  if (product.version) lines.push(`Version they own or are viewing: ${product.version}`);
  if (product.summary) lines.push(`Summary: ${product.summary}`);

  const list = (label: string, items?: readonly string[]) => {
    if (!items?.length) return;
    lines.push("", `${label}:`);
    for (const item of items) lines.push(`- ${item}`);
  };

  list("What it already does", product.features);
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
    "Open by referring to this product by name and asking what they'd want",
    "different about it. Do not open with a generic greeting.",
  );

  return lines.join("\n");
}
