import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Env validation is a boot-time gate, so every case here re-imports the module
 * with a fresh registry (`vi.resetModules` via dynamic import + cache bust).
 */
const VALID: Record<string, string> = {
  NODE_ENV: "development",
  APP_URL: "http://localhost:3000",
  MONGODB_URI: "mongodb://localhost:27017/innovatrix?replicaSet=rs0",
  MONGODB_DB_NAME: "innovatrix",
  AUTH_SECRET: "x".repeat(32),
  STORAGE_BUCKET: "innovatrix-dev",
  STORAGE_ACCESS_KEY_ID: "key",
  STORAGE_SECRET_ACCESS_KEY: "secret",
  ENCRYPTION_KEY: "a".repeat(64),
};

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = process.env;
  process.env = { ...VALID } as NodeJS.ProcessEnv;
  // env.ts memoises after first parse; drop the registry so each case boots clean.
  vi.resetModules();
});

afterEach(() => {
  process.env = original;
});

async function loadEnv() {
  return import("./env");
}

describe("server env", () => {
  it("accepts a complete, valid environment", async () => {
    const { serverEnv } = await loadEnv();
    expect(serverEnv().MONGODB_DB_NAME).toBe("innovatrix");
    // Whatever this default is, it must support structured output — the
    // requirement extraction in ticket 16 cannot run otherwise, and the
    // previous default (`anthropic/claude-opus-4.1`) did not.
    expect(serverEnv().OPENROUTER_MODEL).toBe("google/gemini-3.7-flash");
    expect(serverEnv().OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1");
  });

  it("fails fast and names the missing variable", async () => {
    delete process.env.AUTH_SECRET;
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/AUTH_SECRET/);
  });

  it("names every problem at once, not one per restart", async () => {
    delete process.env.AUTH_SECRET;
    delete process.env.STORAGE_BUCKET;
    const { serverEnv } = await loadEnv();
    try {
      serverEnv();
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/AUTH_SECRET/);
      expect(message).toMatch(/STORAGE_BUCKET/);
      expect(message).toMatch(/\.env\.example/);
    }
  });

  it("rejects a too-short AUTH_SECRET rather than accepting a weak one", async () => {
    process.env.AUTH_SECRET = "short";
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/at least 32 characters/);
  });

  it("rejects a MONGODB_URI that isn’t a mongo URI", async () => {
    process.env.MONGODB_URI = "postgres://localhost/innovatrix";
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/mongodb:\/\//);
  });

  it("rejects an ENCRYPTION_KEY that isn’t 32 bytes of hex (§89)", async () => {
    process.env.ENCRYPTION_KEY = "not-hex";
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/64 hex characters/);
  });

  it("refuses a Stripe key with no webhook secret — §87 forbids unverified fulfilment", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("refuses Google OAuth enabled without credentials", async () => {
    process.env.AUTH_GOOGLE_ENABLED = "true";
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/AUTH_GOOGLE_CLIENT_ID/);
  });

  it("refuses plain http in production", async () => {
    // Next.js declares process.env.NODE_ENV readonly; the whole object is
    // swapped in beforeEach, so writing through a widened view is safe here.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.APP_URL = "http://innovatrix.com";
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/https in production/);
  });

  it("rejects an OPENROUTER_API_KEY that isn’t an OpenRouter key", async () => {
    // Catches the easy mistake of pasting an OpenAI or Anthropic key into the
    // OpenRouter slot, which otherwise fails at the first AI call instead of boot.
    process.env.OPENROUTER_API_KEY = "sk-proj-notanopenrouterkey";
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/OPENROUTER_API_KEY/);
  });

  it("accepts a well-formed OpenRouter key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-abc123";
    const { serverEnv } = await loadEnv();
    expect(serverEnv().OPENROUTER_API_KEY).toBe("sk-or-v1-abc123");
  });

  it("reports only the payment providers whose keys are actually present", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_paystack";
    const { configuredPaymentProviders } = await loadEnv();
    expect(configuredPaymentProviders()).toEqual(["paystack"]);
  });

  /**
   * `KEY=` is how `.env.example` says "fill this in later", and every optional
   * variable has to survive being copied across verbatim.
   *
   * This was a real failure: `CRON_SECRET: z.string().min(16).optional()` looks
   * correct and is not. An empty string is *present*, so `.optional()` never
   * applies, `.min(16)` rejects it, and the process refuses to start naming a
   * variable the author deliberately left blank — following the README's own
   * quick start. Found by trying it.
   */
  it("treats a blank optional variable as unset rather than as a bad value", async () => {
    process.env.CRON_SECRET = "";
    process.env.OPENROUTER_API_KEY = "";
    process.env.OPENROUTER_SITE_URL = "";
    process.env.STORAGE_ENDPOINT = "";
    process.env.MONGODB_TRANSACTIONS = "";

    const { serverEnv } = await loadEnv();

    expect(() => serverEnv()).not.toThrow();
    expect(serverEnv().CRON_SECRET).toBeUndefined();
    expect(serverEnv().OPENROUTER_API_KEY).toBeUndefined();
  });

  it("still rejects a CRON_SECRET that is present and too short", async () => {
    // The blank case above must not have loosened the real check — a
    // four-character shared secret is worse than none, because it looks set.
    process.env.CRON_SECRET = "short";
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/CRON_SECRET/);
  });
});
