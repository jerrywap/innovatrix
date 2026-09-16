import { describe, expect, it } from "vitest";
import {
  assertMove,
  offerIsLive,
  VENDOR_MOVES,
  STAFF_MOVES,
} from "./complete-on-request-service";
import { COMPLETE_ON_REQUEST_STATUSES } from "@/lib/db/enums";

/**
 * Who may move a "complete on request" offer, and where — COS-43.
 *
 * ## Why this is a unit test
 *
 * The moves are a pure function over two literal tables. No transaction, no index,
 * no tenancy filter — which is the line `AGENTS.md` draws, and the reason this is
 * eight assertions rather than a 27th copy of the integration preamble.
 *
 * ## What it is actually protecting
 *
 * One thing above all: **a vendor cannot approve their own offer.** The approval
 * exists because staff are attesting that this vendor can deliver a backend, and an
 * offer that could reach `approved` without them is the whole feature undone.
 */

describe("who may move an offer", () => {
  it("never lets a vendor approve their own offer", () => {
    // The assertion this file exists for.
    expect(() => assertMove("pending", "approved", "vendor")).toThrow();
    expect(() => assertMove("draft", "approved", "vendor")).toThrow();
    expect(() => assertMove("rejected", "approved", "vendor")).toThrow();

    // And staff can, from the one place it makes sense.
    expect(() => assertMove("pending", "approved", "staff")).not.toThrow();
  });

  it("lets a vendor send a new offer and re-send a refused one", () => {
    expect(() => assertMove("draft", "pending", "vendor")).not.toThrow();
    expect(() => assertMove("rejected", "pending", "vendor")).not.toThrow();
    // An offer that has never existed reads as `draft`, so the first submit works
    // from an absent block.
    expect(() => assertMove(undefined, "pending", "vendor")).not.toThrow();
  });

  it("does not let a vendor re-send an offer that is already live or already with us", () => {
    // Both would be no-ops at best; `pending → pending` would also reset the
    // queue position of an offer staff are part-way through reading.
    expect(() => assertMove("approved", "pending", "vendor")).toThrow();
    expect(() => assertMove("pending", "pending", "vendor")).toThrow();
  });

  it("lets either side take a live offer down", () => {
    expect(() => assertMove("approved", "withdrawn", "vendor")).not.toThrow();
    expect(() => assertMove("approved", "withdrawn", "staff")).not.toThrow();
  });

  it("does not let staff refuse an offer nobody has sent", () => {
    // A refusal carries a note the vendor reads. On a draft there is nothing to
    // refuse and nobody waiting to read it.
    expect(() => assertMove("draft", "rejected", "staff")).toThrow();
    expect(() => assertMove("withdrawn", "rejected", "staff")).toThrow();
  });

  it("names both states in the refusal, so a log line says what happened", () => {
    expect(() => assertMove("approved", "approved", "staff")).toThrow(/approved to approved/);
  });

  it("covers every status in the enum", () => {
    // Non-vacuity: the tables are hand-written, and a status added to the enum with
    // no entry in either would silently be a dead end.
    const known = new Set([...Object.keys(VENDOR_MOVES), ...Object.keys(STAFF_MOVES)]);
    const stranded = COMPLETE_ON_REQUEST_STATUSES.filter(
      (status) => !known.has(status) && status !== "withdrawn" && status !== "rejected",
    );
    expect(stranded).toEqual([]);
  });
});

describe("whether an offer is live", () => {
  it("is true only for an approved template", () => {
    expect(
      offerIsLive({ catalogue: "template", completeOnRequest: { status: "approved" } }),
    ).toBe(true);
  });

  it("is false for every other status", () => {
    for (const status of COMPLETE_ON_REQUEST_STATUSES) {
      if (status === "approved") continue;
      expect(
        offerIsLive({ catalogue: "template", completeOnRequest: { status } }),
        status,
      ).toBe(false);
    }
  });

  it("is false for a script, however its offer got there", () => {
    // A script has nothing to complete. `submitOffer` refuses one, so this is the
    // belt to that braces — and the public surfaces read this, not the raw status.
    expect(
      offerIsLive({ catalogue: "script", completeOnRequest: { status: "approved" } }),
    ).toBe(false);
    expect(offerIsLive({ completeOnRequest: { status: "approved" } })).toBe(false);
  });

  it("is false when there is no offer at all, which is almost every product", () => {
    expect(offerIsLive({ catalogue: "template" })).toBe(false);
  });
});
