import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { slugify, uniqueSlug, isSlug } from "./slug";
import { validEnv } from "@/test/env";

/** Corrupt one byte — the smallest change GCM must still refuse. */
function flipFirstByte(buffer: Buffer): Buffer {
  buffer.writeUInt8(buffer.readUInt8(0) ^ 0xff, 0);
  return buffer;
}

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

let original: NodeJS.ProcessEnv | undefined;

afterEach(() => {
  if (original) process.env = original;
  original = undefined;
});

/**
 * Load `crypto.ts` against a given environment.
 *
 * Two caches have to be defeated to change the key mid-test: crypto's own key
 * map, and `serverEnv()`'s memoised parse in `env.ts`. `resetKeyCache()` only
 * clears the first, so a fresh module registry is the honest way — the same
 * approach `env.test.ts` uses, and it keeps a test-only reset hook out of
 * production config.
 *
 * `crypto.ts` reads through `serverEnv()`, which validates the *whole*
 * environment, so a crypto test still needs a complete one. `validEnv()` is
 * that shared minimum; only the encryption keys vary per case.
 */
async function loadCrypto(overrides: Record<string, string | undefined> = {}) {
  original ??= process.env;
  process.env = validEnv({
    ENCRYPTION_KEY: overrides.ENCRYPTION_KEY ?? KEY_A,
    ENCRYPTION_KEY_VERSION: overrides.ENCRYPTION_KEY_VERSION ?? "1",
    ENCRYPTION_KEYS_PREVIOUS: overrides.ENCRYPTION_KEYS_PREVIOUS,
  }) as NodeJS.ProcessEnv;
  vi.resetModules();
  return import("./crypto");
}

describe("seal / open — AES-256-GCM", () => {
  let seal: (p: string, aad?: string) => import("./crypto").SealedBox;
  let open: (b: import("./crypto").SealedBox, aad?: string) => string;
  let isSealed: (v: unknown) => boolean;
  let secretsMatch: (a: string, b: string) => boolean;
  let CryptoError: new (m: string) => Error;

  beforeEach(async () => {
    ({ seal, open, isSealed, secretsMatch, CryptoError } = await loadCrypto());
  });

  it("round-trips a secret", () => {
    const box = seal("hunter2");
    expect(open(box)).toBe("hunter2");
  });

  it("produces a different ciphertext every time", () => {
    // A fixed IV would make identical passwords identifiable by their
    // ciphertext alone, across every product in the catalogue.
    const a = seal("hunter2");
    const b = seal("hunter2");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(open(a)).toBe(open(b));
  });

  it("never contains the plaintext", () => {
    const box = seal("correct-horse-battery-staple");
    const serialized = JSON.stringify(box);
    expect(serialized).not.toContain("correct");
    expect(serialized).not.toContain("staple");
  });

  it("stamps the current key version", async () => {
    expect(seal("x").keyVersion).toBe(1);
    const rotated = await loadCrypto({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_VERSION: "2" });
    expect(rotated.seal("x").keyVersion).toBe(2);
  });

  /* ────────────────────────────────────── tampering */

  it("refuses a flipped ciphertext byte", () => {
    const box = seal("hunter2");
    const bytes = flipFirstByte(Buffer.from(box.ciphertext, "base64"));
    expect(() => open({ ...box, ciphertext: bytes.toString("base64") })).toThrow(CryptoError);
  });

  it("refuses a flipped auth tag", () => {
    const box = seal("hunter2");
    const tag = flipFirstByte(Buffer.from(box.tag, "base64"));
    expect(() => open({ ...box, tag: tag.toString("base64") })).toThrow(CryptoError);
  });

  it("refuses a swapped IV", () => {
    const a = seal("hunter2");
    const b = seal("hunter2");
    expect(() => open({ ...a, iv: b.iv })).toThrow(CryptoError);
  });

  it("gives one message for every failure, so nothing is learned from which", () => {
    const box = seal("hunter2");
    const tag = flipFirstByte(Buffer.from(box.tag, "base64"));
    expect(() => open({ ...box, tag: tag.toString("base64") })).toThrow(
      /Could not decrypt this value/,
    );
  });

  /* ────────────────────────────────────── associated data */

  it("binds a secret to its context", () => {
    // The escalation this prevents: copying a passwordCipher out of one
    // product's document and into another's.
    const box = seal("hunter2", "product-a");
    expect(open(box, "product-a")).toBe("hunter2");
    expect(() => open(box, "product-b")).toThrow(CryptoError);
  });

  it("refuses a sealed-with-aad box opened without one, and vice versa", () => {
    expect(() => open(seal("x", "product-a"))).toThrow(CryptoError);
    expect(() => open(seal("x"), "product-a")).toThrow(CryptoError);
  });

  /* ────────────────────────────────────── key rotation */

  it("opens an old ciphertext after the key rotates", async () => {
    const old = seal("hunter2");
    expect(old.keyVersion).toBe(1);

    const rotated = await loadCrypto({
      ENCRYPTION_KEY: KEY_B,
      ENCRYPTION_KEY_VERSION: "2",
      ENCRYPTION_KEYS_PREVIOUS: `1:${KEY_A}`,
    });

    // The whole point of keyVersion: yesterday's secrets keep opening.
    expect(rotated.open(old)).toBe("hunter2");
    expect(rotated.seal("new").keyVersion).toBe(2);
  });

  it("names the missing version when a retired key was not carried forward", async () => {
    const old = seal("hunter2");
    const rotated = await loadCrypto({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_VERSION: "2" });

    expect(() => rotated.open(old)).toThrow(/key version 1, which is not configured/);
  });

  it("rejects a previous-keys entry that reuses the current version", async () => {
    const bad = await loadCrypto({
      ENCRYPTION_KEY: KEY_B,
      ENCRYPTION_KEY_VERSION: "2",
      ENCRYPTION_KEYS_PREVIOUS: `2:${KEY_A}`,
    });
    expect(() => bad.seal("x")).toThrow(/names exactly one key/);
  });

  it("rejects a retired key of the wrong length", async () => {
    // `ENCRYPTION_KEY` is already constrained to 64 hex characters by env.ts,
    // so its byte check is belt-and-braces. `ENCRYPTION_KEYS_PREVIOUS` is only
    // validated as a string, so this is the path where a short key could
    // actually arrive — and a short key silently selects AES-128.
    const bad = await loadCrypto({
      ENCRYPTION_KEY: KEY_B,
      ENCRYPTION_KEY_VERSION: "2",
      ENCRYPTION_KEYS_PREVIOUS: `1:${"ab".repeat(16)}`,
    });
    expect(() => bad.seal("x")).toThrow(/must decode to 32 bytes/);
  });

  /* ────────────────────────────────────── guards */

  it("refuses to encrypt nothing", () => {
    expect(() => seal("")).toThrow(CryptoError);
  });

  it("recognises a sealed box, and rejects anything else", () => {
    expect(isSealed(seal("x"))).toBe(true);
    expect(isSealed({ iv: "a", tag: "b", ciphertext: "c" })).toBe(false);
    expect(isSealed("hunter2")).toBe(false);
    expect(isSealed(null)).toBe(false);
  });

  it("compares secrets without leaking length or prefix through timing", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "abcd")).toBe(false);
  });
});

describe("slugify", () => {
  it("makes a readable slug", () => {
    expect(slugify("Atlas CRM")).toBe("atlas-crm");
    expect(slugify("  Multi   Space  ")).toBe("multi-space");
  });

  it("spells out & rather than dropping it", () => {
    // "hr-rota" reads as a typo; "hr-and-rota" reads as a name.
    expect(slugify("HR & Rota")).toBe("hr-and-rota");
  });

  it("folds accents so near-identical names collide instead of coexisting", () => {
    expect(slugify("Café Manager")).toBe("cafe-manager");
  });

  it("strips anything that isn't a slug character", () => {
    expect(slugify("Next.js / React!")).toBe("next-js-react");
    expect(slugify("--leading and trailing--")).toBe("leading-and-trailing");
  });

  it("returns an empty string rather than junk when there is nothing to slug", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("recognises its own output", () => {
    for (const name of ["Atlas CRM", "HR & Rota", "Next.js"]) {
      expect(isSlug(slugify(name))).toBe(true);
    }
    expect(isSlug("Not A Slug")).toBe(false);
    expect(isSlug("trailing-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("uses the plain slug when it is free", async () => {
    expect(await uniqueSlug("Atlas CRM", async () => false)).toBe("atlas-crm");
  });

  it("suffixes randomly rather than counting, so it discloses nothing", async () => {
    const taken = new Set(["atlas-crm"]);
    const result = await uniqueSlug("Atlas CRM", async (c) => taken.has(c));

    expect(result).not.toBe("atlas-crm");
    expect(result).not.toBe("atlas-crm-2");
    expect(result).toMatch(/^atlas-crm-[a-z0-9]{4}$/);
  });

  it("falls back to something valid when everything collides", async () => {
    const result = await uniqueSlug("Atlas CRM", async () => true);
    expect(isSlug(result)).toBe(true);
  });

  it("never produces an empty slug", async () => {
    expect(await uniqueSlug("!!!", async () => false)).toBe("item");
  });
});
