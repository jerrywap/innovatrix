import { describe, expect, it } from "vitest";
import {
  LICENCE_ALPHABET,
  checkCharacter,
  generateLicenceKey,
  isValidLicenceKeyFormat,
  maskLicenceKey,
  normaliseLicenceKey,
} from "./licence-key";

/**
 * The key is a bearer token for paid software, and it gets read down a phone
 * line. Both of those are tested here.
 */

describe("shape", () => {
  it("is INVX plus four groups of four", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(generateLicenceKey()).toMatch(/^INVX-[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);
    }
  });

  it("never contains a character people mishear", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      // I/O/0/1. The `INVX` prefix is exempt — a constant read aloud as a word.
      expect(generateLicenceKey().slice(5)).not.toMatch(/[IO01]/);
    }
  });
});

describe("unguessability", () => {
  it("produces no duplicates across a large batch", () => {
    const keys = new Set(Array.from({ length: 5_000 }, () => generateLicenceKey()));
    expect(keys.size).toBe(5_000);
  });

  it("embeds no timestamp, sequence or ordering", () => {
    // Generated back to back. If anything monotonic leaked in, sorting them
    // would reproduce generation order — so a sorted copy matching the
    // original is the failure.
    const keys = Array.from({ length: 200 }, () => generateLicenceKey());
    expect([...keys].sort()).not.toEqual(keys);
  });

  it("uses the whole alphabet roughly evenly", () => {
    // A biased generator is a weaker key that leaves no other trace. 4000 keys
    // × 16 chars is 64,000 draws; every symbol should appear far above a floor
    // that pure chance would clear.
    const counts = new Map<string, number>();
    for (let attempt = 0; attempt < 4_000; attempt += 1) {
      for (const char of generateLicenceKey().slice(5).replace(/-/g, "")) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    for (const symbol of LICENCE_ALPHABET) {
      expect(counts.get(symbol) ?? 0).toBeGreaterThan(500);
    }
  });
});

describe("the check character", () => {
  it("accepts a key it just generated", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(isValidLicenceKeyFormat(generateLicenceKey())).toBe(true);
    }
  });

  it("catches a single mistyped character", () => {
    // The common phone-line error.
    let caught = 0;
    let tried = 0;

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const key = generateLicenceKey();
      const chars = [...key];
      const index = 5 + Math.floor(Math.random() * 15);
      if (chars[index] === "-") continue;

      const current = LICENCE_ALPHABET.indexOf(chars[index]!);
      chars[index] = LICENCE_ALPHABET[(current + 1) % LICENCE_ALPHABET.length]!;
      tried += 1;
      if (!isValidLicenceKeyFormat(chars.join(""))) caught += 1;
    }

    expect(caught).toBe(tried);
  });

  it("catches a transposition, which a plain sum would not", () => {
    // `AB` and `BA` sum identically — the position weight is what makes this
    // fail. Without it this test passes zero of the time.
    let caught = 0;
    let tried = 0;

    for (let attempt = 0; attempt < 300; attempt += 1) {
      const key = generateLicenceKey();
      const chars = [...key];
      const index = 5 + Math.floor(Math.random() * 13);
      if (chars[index] === "-" || chars[index + 1] === "-") continue;
      if (chars[index] === chars[index + 1]) continue;

      [chars[index], chars[index + 1]] = [chars[index + 1]!, chars[index]!];
      tried += 1;
      if (!isValidLicenceKeyFormat(chars.join(""))) caught += 1;
    }

    expect(tried).toBeGreaterThan(100);
    expect(caught).toBe(tried);
  });

  it("rejects a key with a character outside the alphabet", () => {
    // Skipping unknown characters would let `AB!CD` check out as `ABCD`.
    expect(checkCharacter("AB!CD")).toBe("");
    expect(isValidLicenceKeyFormat("INVX-AAAA-AAAA-AAAA-AAA0")).toBe(false);
  });

  const malformed = [
    ["empty", ""],
    ["prefix only", "INVX"],
    ["too short", "INVX-AAAA-AAAA-AAAA"],
    ["too long", "INVX-AAAA-AAAA-AAAA-AAAA-AAAA"],
    ["wrong prefix", "ACME-AAAA-AAAA-AAAA-AAAA"],
    ["nonsense", "not-a-licence-key"],
  ] as const;

  it.each(malformed)("rejects %s", (_label, key) => {
    expect(isValidLicenceKeyFormat(key)).toBe(false);
  });
});

describe("normalising what a human typed", () => {
  it("accepts lowercase, spaces and missing hyphens", () => {
    const key = generateLicenceKey();
    const mangled = key.toLowerCase().replace(/-/g, " ");

    expect(normaliseLicenceKey(mangled)).toBe(key);
    // The point: a valid licence pasted awkwardly out of an email still works.
    expect(isValidLicenceKeyFormat(mangled)).toBe(true);
  });

  it("accepts a key with no separators at all", () => {
    const key = generateLicenceKey();
    expect(isValidLicenceKeyFormat(key.replace(/-/g, ""))).toBe(true);
  });

  it("does not turn an invalid key into a valid one", () => {
    expect(isValidLicenceKeyFormat("invx aaaa aaaa aaaa aaaa")).toBe(false);
  });
});

describe("masking", () => {
  it("keeps the last group and hides the rest", () => {
    const key = generateLicenceKey();
    const masked = maskLicenceKey(key);
    const groups = key.split("-");

    expect(masked).toBe(`INVX-••••-••••-••••-${groups[4]}`);
    // Enough to recognise which licence it is, not enough to use it.
    expect(masked).not.toContain(groups[1]!);
  });
});
