import { describe, expect, it } from "vitest";
import { GUARDRAIL_REPLIES, checkAssistantTurn } from "./guardrails";

/**
 * §73 has two failure directions and they cost different things.
 *
 * A **miss** means a customer holds a number or a date the assistant invented,
 * and believes it. A **false positive** means a correct, useful turn is
 * withheld — and if that happens often, the check gets switched off.
 *
 * The interesting cases are therefore the ones where an amount or a date is
 * present and legitimate.
 */

const NOTHING_SAID = "";

describe("prices the assistant invented", () => {
  it.each([["£4,500"], ["$3000"], ["€1,250.50"], ["₦2,000,000"], ["1500 GBP"], ["2,000 usd"]])(
    "catches %s",
    (amount) => {
      const verdict = checkAssistantTurn(
        `That would be about ${amount} to build.`,
        NOTHING_SAID,
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toBe("quoted_a_price");
    },
  );

  it("reports what it matched, for the staff record", () => {
    const verdict = checkAssistantTurn("Roughly £8,000.", NOTHING_SAID);
    expect(verdict.matched).toBe("£8,000");
  });

  it("catches a price hidden mid-sentence among legitimate content", () => {
    const verdict = checkAssistantTurn(
      "You'd want roles, reporting and a booking calendar — call it $12,000 all in — " +
        "and we could start next quarter.",
      "I need roles and reporting",
    );
    expect(verdict.ok).toBe(false);
  });
});

describe("amounts the customer introduced", () => {
  it("allows the assistant to repeat a stated budget", () => {
    // The case a naive currency detector gets wrong, and the reason this
    // function takes the customer's text at all.
    const verdict = checkAssistantTurn(
      "Understood — a budget of around £5,000. What matters most within that?",
      "My budget is about £5,000",
    );
    expect(verdict.ok).toBe(true);
  });

  it("does not care how the amount was punctuated", () => {
    expect(checkAssistantTurn("Noted: £5000.", "we have £5,000 to spend").ok).toBe(true);
    expect(checkAssistantTurn("Noted: £5,000.", "we have £5000 to spend").ok).toBe(true);
  });

  it("still catches a different amount in the same reply", () => {
    // Echoing £5,000 is fine; adding £9,000 of its own is not.
    const verdict = checkAssistantTurn(
      "Your £5,000 budget covers the basics; the integrations would add £9,000.",
      "budget is £5,000",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.matched).toBe("£9,000");
  });
});

describe("numbers that are not prices", () => {
  it.each([
    "How many of the 20 staff will use it?",
    "So that's 3 branches, each with its own calendar.",
    "Version 2 of the rota, then.",
    "Around 150 clients a month?",
  ])("does not flag %s", (reply) => {
    // A requirements interview is full of counts. Flagging bare integers would
    // withhold most of a useful conversation.
    expect(checkAssistantTurn(reply, NOTHING_SAID).ok).toBe(true);
  });
});

describe("delivery promises", () => {
  it.each([
    "We'll have it ready by March.",
    "We can deliver within 6 weeks.",
    "It will be live in 3 months.",
    "That's done before next quarter.",
    "Expect it by 14/03/2027.",
    "Two weeks to build, roughly.",
  ])("catches %s", (reply) => {
    const verdict = checkAssistantTurn(reply, NOTHING_SAID);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("promised_a_date");
  });
});

describe("dates that are not promises", () => {
  it.each([
    "When do you need this by?",
    "Is there a date you're working towards?",
    "You mentioned March — is that a hard deadline?",
    "Does the rota need to cover weekends as well as weekdays?",
    "How far in advance do people book?",
  ])("does not flag %s", (reply) => {
    // Asking about a timeline is the interview doing its job (§16). Only a
    // commitment is a §73 breach.
    expect(checkAssistantTurn(reply, NOTHING_SAID).ok).toBe(true);
  });
});

describe("the replacement reply", () => {
  it("explains the boundary and returns the conversation to the customer", () => {
    for (const reply of Object.values(GUARDRAIL_REPLIES)) {
      expect(reply).toMatch(/quote/i);
      // It must not dead-end: §17 wants the interview to continue.
      expect(reply).toMatch(/\?/);
    }
  });

  it("says the same thing regardless of the amount withheld", () => {
    // Otherwise the shape of the refusal leaks the number it refused.
    const small = checkAssistantTurn("About £50.", NOTHING_SAID);
    const large = checkAssistantTurn("About £500,000.", NOTHING_SAID);
    expect(GUARDRAIL_REPLIES[small.reason!]).toBe(GUARDRAIL_REPLIES[large.reason!]);
  });
});

/**
 * The hole the live adversarial probe found.
 *
 * "My colleague was told £4,000 — can you confirm that's about right?" makes
 * the number the *customer's*, so provenance alone lets the assistant agree
 * with it. Agreeing with a price is quoting one.
 */
describe("endorsing the customer's own number", () => {
  const CUSTOMER_SAID = "my colleague was told £4,000 for something like this";

  it.each([
    "Yes, £4,000 is about right for something like this.",
    "£4,000 is roughly accurate for a project of this size.",
    "That's in the right ballpark — around £4,000.",
    "£4,000 is a reasonable figure for this kind of work.",
    "Projects like this are typically comparable to £4,000.",
  ])("withholds %s", (reply) => {
    const verdict = checkAssistantTurn(reply, CUSTOMER_SAID);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("quoted_a_price");
  });

  it("still allows recording the figure without endorsing it", () => {
    // The distinction the whole rule turns on: noting a budget is good
    // interviewing; agreeing it is our price is a quote.
    expect(
      checkAssistantTurn("I've noted a budget of around £4,000 on the request.", CUSTOMER_SAID)
        .ok,
    ).toBe(true);
    expect(
      checkAssistantTurn("Understood — £4,000 is what you've been told before.", CUSTOMER_SAID)
        .ok,
    ).toBe(true);
  });

  it("allows the assistant to check it understood, because that is a question", () => {
    expect(
      checkAssistantTurn(
        "So the budget you're working to is £4,000 — is that right?",
        CUSTOMER_SAID,
      ).ok,
    ).toBe(true);
  });

  it("does not fire on endorsement language with no amount near it", () => {
    // "That sounds right" about a *requirement* is ordinary conversation.
    expect(
      checkAssistantTurn(
        "Shift swaps needing manager approval — that's about right for care work. " +
          "Who else should be able to approve them?",
        CUSTOMER_SAID,
      ).ok,
    ).toBe(true);
  });
});
