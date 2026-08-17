import { describe, expect, it } from "vitest";
import { ESCAPE_HATCH, OPENERS, openersFor } from "./openers";

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
