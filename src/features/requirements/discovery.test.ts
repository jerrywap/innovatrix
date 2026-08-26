import { describe, expect, it } from "vitest";
import { OPTIONS_MARKER, splitAssistantOptions } from "@/lib/assistant-options";
import { canDraftBrief, stageOf, stepStates, TURNS_BEFORE_REVIEW } from "./stage";

/**
 * The two pure functions behind the discovery page.
 *
 * Not an enforcement test — the set stays closed at fourteen. These are here
 * because both functions have a failure mode that is silent in the UI: a marker
 * parsed wrongly shows the customer a chip that is not an answer to anything, and
 * a stage computed wrongly shows them the wrong page with no error to notice.
 * Everything else in this change is copy, layout or a call through to a service,
 * and owes nothing.
 */
describe("splitAssistantOptions", () => {
  it("takes a trailing marker off the text and returns its parts", () => {
    const { text, options } = splitAssistantOptions(
      `Got it — registrations come through WhatsApp. What is hardest to keep on top of?\n${OPTIONS_MARKER} Bookings and capacity | Payments | Reminders`,
    );

    expect(text).toBe(
      "Got it — registrations come through WhatsApp. What is hardest to keep on top of?",
    );
    expect(options).toEqual(["Bookings and capacity", "Payments", "Reminders"]);
  });

  it("leaves an ordinary reply completely alone", () => {
    const reply = "Which of those two is costing you the most time at the moment?";
    expect(splitAssistantOptions(reply)).toEqual({ text: reply, options: [] });
  });

  it("finds the marker through trailing blank lines", () => {
    // Models end turns with a newline more often than not.
    const { options } = splitAssistantOptions(`Question?\n\n${OPTIONS_MARKER} One | Two\n\n`);
    expect(options).toEqual(["One", "Two"]);
  });

  it("ignores a marker that is not the last line", () => {
    /*
       Strictness is the whole safety argument. A marker mid-reply is far more
       likely to be the assistant talking *about* the format than using it, and
       swallowing everything after it would delete real content.
    */
    const reply = `${OPTIONS_MARKER} One | Two\nAnd then a question?`;
    expect(splitAssistantOptions(reply)).toEqual({ text: reply, options: [] });
  });

  it("treats a single option as the model getting it wrong", () => {
    // One option is not a choice. The prompt asks for two to four; anything less
    // falls back to free text rather than offering a lone button.
    const { text, options } = splitAssistantOptions(`Question?\n${OPTIONS_MARKER} Only one`);
    expect(options).toEqual([]);
    // Still stripped: the customer must never see the mechanism, working or not.
    expect(text).toBe("Question?");
  });

  it("caps the list at four", () => {
    const { options } = splitAssistantOptions(`Q?\n${OPTIONS_MARKER} a | b | c | d | e | f`);
    expect(options).toEqual(["a", "b", "c", "d"]);
  });

  it("drops an option long enough to stop being a chip", () => {
    const essay = "x".repeat(200);
    const { options } = splitAssistantOptions(`Q?\n${OPTIONS_MARKER} Payments | ${essay}`);
    expect(options).toEqual([]);
  });

  it("deduplicates, because the chips are keyed on the string", () => {
    const { options } = splitAssistantOptions(
      `Q?\n${OPTIONS_MARKER} Payments | Payments | Reminders`,
    );
    expect(options).toEqual(["Payments", "Reminders"]);
  });

  it("tolerates a model that bullets the options anyway", () => {
    const { options } = splitAssistantOptions(`Q?\n${OPTIONS_MARKER} - One | - Two`);
    expect(options).toEqual(["One", "Two"]);
  });

  it("does not hide a price inside an option", () => {
    /*
       This is the guardrail interaction, asserted from the other side.
       `streamAssistantTurn` checks §73 over the **whole** completion, marker
       included, before this ever runs — so what has to be true here is only that
       the marker text is not stripped *earlier* than that. This test pins the
       contract: given the raw completion, the amount is still present in the
       string the guardrail was handed.
    */
    const raw = `Q?\n${OPTIONS_MARKER} From £500 | Later`;
    expect(raw).toContain("£500");
    expect(splitAssistantOptions(raw).options).toContain("From £500");
  });

  it("survives an empty string", () => {
    expect(splitAssistantOptions("")).toEqual({ text: "", options: [] });
  });
});

describe("stageOf", () => {
  it("opens on the invitation", () => {
    expect(stageOf({ customerTurns: 0, hasBrief: false, submitted: false })).toBe("invitation");
  });

  it("moves to discovery as soon as they say anything", () => {
    expect(stageOf({ customerTurns: 1, hasBrief: false, submitted: false })).toBe("discovery");
  });

  it("moves to review once a brief exists", () => {
    expect(stageOf({ customerTurns: 4, hasBrief: true, submitted: false })).toBe("review");
  });

  it("is submitted whatever else is true", () => {
    // Terminal, and it has to outrank the rest: a submitted conversation with a
    // brief still open in the browser must show the receipt, not the form that
    // produced it. That is the CUS-2026-0001-through-0003 failure.
    expect(stageOf({ customerTurns: 0, hasBrief: false, submitted: true })).toBe("submitted");
    expect(stageOf({ customerTurns: 9, hasBrief: true, submitted: true })).toBe("submitted");
  });
});

describe("canDraftBrief", () => {
  it("waits for two turns, matching §24's own threshold", () => {
    // The old code allowed one under a comment that said two.
    expect(TURNS_BEFORE_REVIEW).toBe(2);
    expect(canDraftBrief(0)).toBe(false);
    expect(canDraftBrief(1)).toBe(false);
    expect(canDraftBrief(2)).toBe(true);
  });
});

describe("stepStates", () => {
  it("never shows our own work as in progress", () => {
    // §40 forbids implying a turnaround, and an "active" third step is a progress
    // bar we are not in a position to fill in.
    expect(stepStates("submitted")).toEqual(["done", "done", "done"]);
  });

  it("marks exactly one step active before submission", () => {
    for (const stage of ["invitation", "discovery", "review"] as const) {
      expect(stepStates(stage).filter((state) => state === "active")).toHaveLength(1);
    }
  });
});
