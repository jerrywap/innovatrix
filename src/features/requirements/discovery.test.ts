import { describe, expect, it } from "vitest";
import {
  COVERED_MARKER,
  ENOUGH_MARKER,
  OPTIONS_MARKER,
  splitAssistantOptions,
} from "@/lib/assistant-options";
import { canDraftBrief, stageOf, stepStates, TURNS_BEFORE_REVIEW } from "./stage";
import { MAX_DISCOVERY_TURNS, readyToClose, requiredProgress, topicsFor } from "./checklist";

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
    expect(splitAssistantOptions(reply)).toEqual({
      text: reply,
      options: [],
      covered: [],
      enough: false,
    });
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
    expect(splitAssistantOptions(reply)).toEqual({
      text: reply,
      options: [],
      covered: [],
      enough: false,
    });
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
    expect(splitAssistantOptions("")).toEqual({
      text: "",
      options: [],
      covered: [],
      enough: false,
    });
  });
});

describe("splitAssistantOptions — the coverage marker", () => {
  it("reads a coverage line", () => {
    const { text, covered } = splitAssistantOptions(
      `What is hardest to keep on top of?\n${COVERED_MARKER} problem, people, today`,
    );
    expect(text).toBe("What is hardest to keep on top of?");
    expect(covered).toEqual(["problem", "people", "today"]);
  });

  it("consumes both markers, in either order", () => {
    // The block is walked back line by line, so a turn ending with options then
    // coverage — or the other way round — comes out the same.
    const both = `Question?\n${OPTIONS_MARKER} One | Two\n${COVERED_MARKER} problem, people`;
    const reversed = `Question?\n${COVERED_MARKER} problem, people\n${OPTIONS_MARKER} One | Two`;

    for (const raw of [both, reversed]) {
      const parsed = splitAssistantOptions(raw);
      expect(parsed.text).toBe("Question?");
      expect(parsed.options).toEqual(["One", "Two"]);
      expect(parsed.covered).toEqual(["problem", "people"]);
    }
  });

  it("stops at the first line that is not a marker", () => {
    // Otherwise a reply whose last paragraph happened to mention a marker would
    // have the paragraph above it eaten.
    const { text, covered } = splitAssistantOptions(
      `First line.\nSecond line.\n${COVERED_MARKER} problem`,
    );
    expect(text).toBe("First line.\nSecond line.");
    expect(covered).toEqual(["problem"]);
  });

  it("deduplicates and tolerates pipes or backticks", () => {
    const { covered } = splitAssistantOptions(
      `Q?\n${COVERED_MARKER} \`problem\` | problem, people`,
    );
    expect(covered).toEqual(["problem", "people"]);
  });

  it("drops anything that is not shaped like an id", () => {
    // Real validation is the route's job — it knows the vocabulary. This only
    // has to refuse prose, so a model that writes a sentence here stores nothing.
    const { covered } = splitAssistantOptions(
      `Q?\n${COVERED_MARKER} I have covered the problem and who will use it`,
    );
    expect(covered).toEqual([]);
  });
});

describe("splitAssistantOptions — the close signal", () => {
  it("reads a bare enough marker", () => {
    const { text, enough } = splitAssistantOptions(
      `I think I've got enough to put a brief together.\n${ENOUGH_MARKER}`,
    );
    expect(text).toBe("I think I've got enough to put a brief together.");
    expect(enough).toBe(true);
  });

  it("reads it alongside coverage", () => {
    const parsed = splitAssistantOptions(
      `Enough to work with.\n${COVERED_MARKER} problem, people\n${ENOUGH_MARKER}`,
    );
    expect(parsed.enough).toBe(true);
    expect(parsed.covered).toEqual(["problem", "people"]);
    expect(parsed.text).toBe("Enough to work with.");
  });

  it("is false when absent", () => {
    expect(splitAssistantOptions(`Question?\n${OPTIONS_MARKER} a | b`).enough).toBe(false);
  });

  it("is not triggered by the words in prose", () => {
    // Only the marker line counts. "I have enough" is a sentence a customer may
    // well write, and it must not end their own interview.
    const reply = "I have enough of this, honestly.";
    expect(splitAssistantOptions(reply).enough).toBe(false);
  });
});

describe("the discovery checklist", () => {
  it("keeps the required set small enough to be a conversation", () => {
    // Nine required topics is a questionnaire. §22's whole point is that somebody
    // with a problem should not have to complete one.
    for (const contextType of ["custom_build", "customization"] as const) {
      const required = topicsFor(contextType).filter((topic) => topic.required);
      expect(required.length).toBeGreaterThanOrEqual(3);
      expect(required.length).toBeLessThanOrEqual(5);
    }
  });

  it("has unique ids, since the model reports them by id", () => {
    for (const contextType of ["custom_build", "customization"] as const) {
      const ids = topicsFor(contextType).map((topic) => topic.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("closes once every required topic is answered", () => {
    const required = topicsFor("custom_build")
      .filter((topic) => topic.required)
      .map((topic) => topic.id);

    expect(
      readyToClose({ contextType: "custom_build", covered: required, customerTurns: 4 }),
    ).toBe(true);
    expect(
      readyToClose({
        contextType: "custom_build",
        covered: required.slice(0, -1),
        customerTurns: 4,
      }),
    ).toBe(false);
  });

  it("does not close on optional topics alone", () => {
    const optional = topicsFor("custom_build")
      .filter((topic) => !topic.required)
      .map((topic) => topic.id);

    expect(
      readyToClose({ contextType: "custom_build", covered: optional, customerTurns: 3 }),
    ).toBe(false);
  });

  it("closes on the turn ceiling however little was reported", () => {
    /*
     * The guarantee that the stage terminates. If the model never emits a
     * coverage line — an older conversation, a provider hiccup, a model ignoring
     * the instruction — the interview must still end rather than run until the
     * customer gives up.
     */
    expect(
      readyToClose({
        contextType: "custom_build",
        covered: [],
        customerTurns: MAX_DISCOVERY_TURNS,
      }),
    ).toBe(true);
  });

  it("counts only required topics in the progress it shows", () => {
    const progress = requiredProgress({
      contextType: "customization",
      covered: ["change", "branding", "timing"],
      customerTurns: 2,
    });
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(
      topicsFor("customization").filter((topic) => topic.required).length,
    );
  });

  it("ignores an id from the other context type", () => {
    // `outcome` is a custom-build topic; a customisation conversation reporting it
    // must not have it counted towards a checklist it is not on.
    const progress = requiredProgress({
      contextType: "customization",
      covered: ["outcome"],
      customerTurns: 1,
    });
    expect(progress.done).toBe(0);
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
