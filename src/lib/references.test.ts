import { describe, expect, it } from "vitest";
import {
  InMemoryCounterStore,
  ReferenceError,
  counterKey,
  formatReference,
  generateReference,
  isReference,
  parseReference,
} from "./references";

describe("references — formatting", () => {
  it("produces the §26 shape", () => {
    expect(formatReference("REQ", 2026, 148)).toBe("REQ-2026-0148");
    expect(formatReference("ORD", 2026, 1254)).toBe("ORD-2026-1254");
    expect(formatReference("INV", 2026, 921)).toBe("INV-2026-0921");
  });

  it("keeps growing past four digits rather than wrapping", () => {
    expect(formatReference("ORD", 2026, 12_345)).toBe("ORD-2026-12345");
  });

  it("rejects unknown prefixes and non-positive sequences", () => {
    // @ts-expect-error — deliberately invalid prefix
    expect(() => formatReference("ZZZ", 2026, 1)).toThrow(ReferenceError);
    expect(() => formatReference("REQ", 2026, 0)).toThrow(ReferenceError);
    expect(() => formatReference("REQ", 2026, 1.5)).toThrow(ReferenceError);
  });
});

describe("references — parsing", () => {
  it("round-trips", () => {
    expect(parseReference("REQ-2026-0148")).toEqual({
      prefix: "REQ",
      year: 2026,
      sequence: 148,
    });
  });

  it("is forgiving about case and whitespace, since customers type these", () => {
    expect(parseReference("  ord-2026-1254 ").prefix).toBe("ORD");
  });

  it("rejects malformed input", () => {
    expect(isReference("REQ-2026")).toBe(false);
    expect(isReference("REQUEST-2026-0148")).toBe(false);
    expect(isReference("ZZZ-2026-0148")).toBe(false);
    expect(isReference("REQ-2026-0148")).toBe(true);
  });
});

describe("references — generation", () => {
  it("increments per prefix and year independently", async () => {
    const store = new InMemoryCounterStore();
    expect(await generateReference(store, "ORD", 2026)).toBe("ORD-2026-0001");
    expect(await generateReference(store, "ORD", 2026)).toBe("ORD-2026-0002");
    expect(await generateReference(store, "INV", 2026)).toBe("INV-2026-0001");
    expect(await generateReference(store, "ORD", 2027)).toBe("ORD-2027-0001");
  });

  it("namespaces counters by prefix and year", () => {
    expect(counterKey("ORD", 2026)).toBe("reference:ORD:2026");
  });

  /**
   * Ticket 00 acceptance criterion: 1,000 concurrent generations produce 1,000
   * distinct, gapless references. This proves the *contract* — ticket 01's
   * MongoDB store must satisfy the same test against a real replica set,
   * because only an atomic $inc makes it true across processes.
   */
  it("produces 1,000 distinct, gapless references under concurrency", async () => {
    const store = new InMemoryCounterStore();
    const refs = await Promise.all(
      Array.from({ length: 1000 }, () => generateReference(store, "ORD", 2026)),
    );

    expect(new Set(refs).size).toBe(1000);

    const sequences = refs.map((r) => parseReference(r).sequence).sort((a, b) => a - b);
    expect(sequences[0]).toBe(1);
    expect(sequences.at(-1)).toBe(1000);
    expect(sequences.every((s, i) => s === i + 1)).toBe(true);
  });
});
