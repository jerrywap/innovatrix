import { describe, expect, it } from "vitest";
import { CUSTOMIZATION_AREAS } from "@/lib/db/enums";
import { customizationOpenersFor, ESCAPE_HATCH, OPENERS, openersFor } from "./openers";

describe("the opener pool", () => {
  it("has no duplicates", () => {
    // `conversation.tsx` keys its chips on the string itself, so a repeat is a
    // React key collision rather than a cosmetic slip.
    expect(new Set(OPENERS).size).toBe(OPENERS.length);
  });

  it("never contains the escape hatch", () => {
    // It is appended by `openersFor`; in the pool as well it could be drawn
    // twice and rendered twice.
    expect(OPENERS).not.toContain(ESCAPE_HATCH);
  });

  it("is big enough to be worth sampling", () => {
    expect(OPENERS.length).toBeGreaterThanOrEqual(90);
  });

  it("speaks the customer's language, not ours", () => {
    // §100. If these words appear, somebody has written a feature list.
    const jargon = /\b(API|CRUD|module|role-based|schema|backend|SaaS|dashboard)\b/i;
    const offenders = OPENERS.filter((line) => jargon.test(line));
    expect(offenders).toEqual([]);
  });

  it("is written in the first person, as a problem", () => {
    const firstPerson =
      /^(I|We|My|Our|Everything|Nobody|Two|Staff|Returns|Parents|Customers|Deadlines|Expenses|Snagging)\b/;
    const offenders = OPENERS.filter((line) => !firstPerson.test(line));
    expect(offenders).toEqual([]);
  });
});

describe("openersFor", () => {
  it("returns the requested count plus the escape hatch, last", () => {
    const picked = openersFor(3);
    expect(picked).toHaveLength(4);
    expect(picked.at(-1)).toBe(ESCAPE_HATCH);
  });

  it("never repeats within one draw", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const picked = openersFor(3);
      expect(new Set(picked).size).toBe(picked.length);
    }
  });

  it("draws from across the pool rather than the same few", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 200; attempt += 1) {
      for (const line of openersFor(3)) seen.add(line);
    }
    // 200 draws of 3 from ~100 would hit nearly all of them; anything under a
    // third means the shuffle is not shuffling.
    expect(seen.size).toBeGreaterThan(OPENERS.length / 3);
  });

  it("does not mutate the pool", () => {
    const before = [...OPENERS];
    openersFor(3);
    openersFor(10);
    expect([...OPENERS]).toEqual(before);
  });

  it("copes with being asked for more than exists", () => {
    const picked = openersFor(OPENERS.length + 50);
    expect(picked).toHaveLength(OPENERS.length + 1);
    expect(new Set(picked).size).toBe(picked.length);
  });
});

/**
 * The `/customize` chips, held to the same two rules that matter.
 *
 * A separate `describe` rather than folding them into the pool above, because
 * they are a different kind of line doing a different job — the pool helps
 * somebody name a problem, these help somebody who already has a product say what
 * is wrong with it. What they share is the two failure modes worth a test: a
 * duplicate is a React key collision, and our vocabulary leaking into a chip is
 * the §100 breach the pool is already checked for.
 */
describe("customizationOpenersFor", () => {
  it("covers every area, so a vendor's pick can never fall through", () => {
    /*
     * `suggestedAreas` is a permissive `[String]` in Mongoose and constrained
     * only in the Zod schema, so a stored document can hold any of the eight —
     * and a missing entry would render as a raw enum value like
     * `payment_methods` in front of a customer.
     */
    const all = customizationOpenersFor(CUSTOMIZATION_AREAS, CUSTOMIZATION_AREAS.length);
    expect(all).toHaveLength(CUSTOMIZATION_AREAS.length + 1);
    expect(all.filter((line) => line.includes("_"))).toEqual([]);
  });

  it("speaks the customer's language, not ours", () => {
    // The same regex the pool is held to — and note it bans "dashboard", which
    // *is* one of the eight areas. The enum is our vocabulary; the chip is theirs.
    const jargon = /\b(API|CRUD|module|role-based|schema|backend|SaaS|dashboard)\b/i;
    const offenders = customizationOpenersFor(
      CUSTOMIZATION_AREAS,
      CUSTOMIZATION_AREAS.length,
    ).filter((line) => jargon.test(line));
    expect(offenders).toEqual([]);
  });

  it("has no duplicates, however the areas are ordered", () => {
    const picked = customizationOpenersFor(["reports", "reports", "branding"], 8);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it("puts the vendor's chosen areas first", () => {
    // §50: `suggestedAreas` is curated by somebody who knows the software, so it
    // outranks our default ordering.
    const picked = customizationOpenersFor(["payment_methods"]);
    expect(picked[0]).toBe(customizationOpenersFor(["payment_methods"], 1)[0]);
    expect(picked[0]).toContain("payment");
  });

  it("ends with the escape hatch, like the pool does", () => {
    expect(customizationOpenersFor([]).at(-1)).toBe(ESCAPE_HATCH);
  });

  it("ignores an area this build has never heard of", () => {
    // Rather than rendering it raw. The Mongoose field would happily store one.
    const picked = customizationOpenersFor(["teleportation", "reports"]);
    expect(picked).not.toContain("teleportation");
    expect(picked.at(-1)).toBe(ESCAPE_HATCH);
  });

  it("is stable, so a chip does not move between two visits", () => {
    // Unlike the discovery pool there is no variety to buy here, and a chip that
    // jumps position on reload just looks unstable.
    expect(customizationOpenersFor(["reports"])).toEqual(customizationOpenersFor(["reports"]));
  });
});
