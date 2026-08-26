/**
 * Which of four things this page is currently doing.
 *
 * ## Why the page needed a stage at all
 *
 * `/custom-software` rendered one layout for every situation. Three explainer
 * cards, a conversation, and — once there was anything to summarise — a brief
 * appended below as a third sibling. So the invitation, the interview and the
 * document that came out of it were all on screen together, and none of them was
 * ever the thing the page was about. The customer scrolled past the marketing
 * copy to reach the conversation, then past the conversation to reach the brief.
 *
 * Four states, each with one job:
 *
 * | stage | the page is | the customer is |
 * |---|---|---|
 * | `invitation` | an invitation | deciding whether to start |
 * | `discovery` | a workspace | answering questions |
 * | `review` | a document | correcting what we understood |
 * | `submitted` | a receipt | waiting on us |
 *
 * ## Derived, never stored
 *
 * A stage column would be a fifth place for the truth to live, behind the
 * transcript, the drafted brief and `submittedRequestId` — and the first one to
 * go stale, because it would need writing on every transition rather than
 * following from them.
 *
 * It is not a URL parameter either. Every input is already server-known or
 * client-obvious, so putting it in the query string would let a link assert a
 * stage the conversation is not in: `?stage=review` on an empty conversation, and
 * a page insisting it has understood something nobody has said. The repo's
 * URL-state convention covers search, filter, sort and pagination — things a
 * customer wants to link to and come back to. A stage is a consequence, not a
 * choice.
 *
 * ## Pure, so it can be tested and so it cannot disagree with itself
 *
 * The progress indicator, the collapsing intro and the review layout all read the
 * same function. When those were three separate conditions they were three
 * chances to differ — and did: `assistant.tsx` gated its review panel on one
 * customer message under a comment that said two.
 */
export type DiscoveryStage = "invitation" | "discovery" | "review" | "submitted";

export interface StageInput {
  /** Turns the customer has taken. Their messages only. */
  customerTurns: number;
  /** A brief has been drafted, or the customer asked to write one by hand. */
  hasBrief: boolean;
  /** The conversation has become a request. Terminal. */
  submitted: boolean;
}

export function stageOf(input: StageInput): DiscoveryStage {
  if (input.submitted) return "submitted";
  if (input.hasBrief) return "review";
  return input.customerTurns > 0 ? "discovery" : "invitation";
}

/**
 * Enough said to be worth summarising.
 *
 * **Two** customer turns, which is what `assistant.tsx`'s comment claimed while
 * its code accepted one. One turn is a sentence; a brief drawn from a sentence is
 * mostly the model's guesses, and every one of those guesses is a line somebody
 * then has to read and untick. It is also the threshold §24 already uses before
 * offering a marketplace match, so the two moments arrive together instead of one
 * interrupting the other.
 */
export const TURNS_BEFORE_REVIEW = 2;

export function canDraftBrief(customerTurns: number): boolean {
  return customerTurns >= TURNS_BEFORE_REVIEW;
}

/** The three steps, in §35's wording. `id` is what `stageOf` maps onto. */
export const DISCOVERY_STEPS = [
  {
    id: "tell",
    label: "Tell us what you need",
    short: "Tell us",
    detail: "Describe the problem in your own words.",
  },
  {
    id: "review",
    label: "Review what we understood",
    short: "Review",
    detail: "Check the brief we make from the conversation.",
  },
  {
    id: "quote",
    label: "We scope and quote",
    short: "Scope & quote",
    detail: "A person reviews it and prepares the next step.",
  },
] as const;

export type StepState = "done" | "active" | "todo";

/**
 * Each step's state at a given stage.
 *
 * `submitted` marks all three complete rather than making the third active. The
 * third step is *our* work, and a page that shows it half-finished implies a
 * progress bar we are not in a position to fill in — we do not know how long
 * scoping takes and §40 forbids inventing a turnaround. Done means "your part is
 * done", which is the true and useful statement.
 */
export function stepStates(stage: DiscoveryStage): StepState[] {
  switch (stage) {
    case "invitation":
    case "discovery":
      return ["active", "todo", "todo"];
    case "review":
      return ["done", "active", "todo"];
    case "submitted":
      return ["done", "done", "done"];
  }
}
