import "server-only";
import { z } from "zod";

/**
 * Server environment — spec §88 ("never expose server secrets to browser code").
 *
 * This module imports `server-only`, so importing it from a Client Component is
 * a build error rather than a runtime leak. Public values live in `public-env.ts`.
 *
 * Validation runs at module load: a missing or malformed variable fails the
 * process at boot with the variable named, instead of surfacing as `undefined`
 * inside a payment call three weeks later.
 */

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

/**
 * A flag that may legitimately be absent — including as the empty string, which
 * is what `KEY=` in a `.env` file produces. `.optional()` alone does not cover
 * that case: the variable *is* present, it is just blank, so the enum rejects
 * it and boot fails on a line the author meant as "unset".
 */
const optionalBool = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  bool.optional(),
);

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /* ── Core ─────────────────────────────────────────────── */
  APP_URL: z.url("APP_URL must be an absolute URL, e.g. https://innovatrix.com"),

  /* ── Database (ticket 01) ─────────────────────────────── */
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("mongodb://") || v.startsWith("mongodb+srv://"), {
      message: "MONGODB_URI must start with mongodb:// or mongodb+srv://",
    }),
  MONGODB_DB_NAME: z.string().min(1).default("innovatrix"),
  /* Multi-document transactions need a replica set. Left unset this is derived
     from the URI (`mongodb+srv` ⇒ Atlas ⇒ always a replica set; otherwise look
     for `replicaSet=`). Set it explicitly to override the guess — getting it
     wrong in the *optimistic* direction makes Better Auth fail every write
     against a standalone mongod. See `supportsTransactions()`. */
  MONGODB_TRANSACTIONS: optionalBool,

  /* ── Auth (ticket 03) ─────────────────────────────────── */
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_GOOGLE_ENABLED: bool.default(false),
  AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  /* §75 — verified email is required before checkout, not before browsing. */
  AUTH_REQUIRE_EMAIL_VERIFICATION: bool.default(true),
  /* Sessions live 30 days and are refreshed once a day (§75). */
  AUTH_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /* ── Object storage (ticket 05) ─────────────────────────
     STORAGE_ENDPOINT is the provider switch: absent ⇒ AWS S3 (host derived
     from region); present ⇒ S3-compatible (R2, MinIO). An endpoint left
     pointing at the wrong provider sends every request to the wrong host, so
     an empty string normalises to undefined rather than failing URL validation.

     Note virtual-hosted addressing is correct for AWS *and* R2 — only MinIO
     and LocalStack need path-style, hence the separate opt-in flag below. */
  STORAGE_ENDPOINT: z
    .string()
    .transform((v) => (v.trim() === "" ? undefined : v.trim()))
    .pipe(z.url().optional())
    .optional(),
  STORAGE_REGION: z.string().min(1).default("us-east-1"),
  /* MinIO / LocalStack only. AWS and R2 both use virtual-hosted addressing. */
  STORAGE_FORCE_PATH_STYLE: bool.default(false),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  /* Root prefix for every object. The bucket may be shared with other
     applications, so nothing is ever written outside it (§88). */
  STORAGE_KEY_PREFIX: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "STORAGE_KEY_PREFIX must be lowercase alphanumeric/hyphen")
    .default("innovatrix"),

  /* ── Encryption for stored credentials (ticket 07, §89) ── */
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
  /* Stamped into every value `seal()` writes, so a rotation can be told apart
     from what came before. Bump it when ENCRYPTION_KEY changes. */
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  /* Retired keys that must still open existing ciphertext: "1:<hex>,2:<hex>".
     Without this, rotating the key is a migration over every stored secret
     rather than a config change. */
  ENCRYPTION_KEYS_PREVIOUS: z
    .string()
    .transform((v) => (v.trim() === "" ? undefined : v.trim()))
    .optional(),

  /* ── Payments (ticket 12) — keys live here, never in the database ──
     Every one is optional: a provider with no key is simply not configured,
     and `/admin/settings/payments` reports which variable is missing. Making
     them required would stop the app booting because PayPal is not set up
     yet, which is not a reason to be down. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  /**
   * PayPal's API base differs between sandbox and live, and there is nothing
   * in a client id that says which one it is. Defaults to sandbox: the failure
   * mode of guessing wrong towards live is charging a real card in testing.
   */
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),

  /**
   * Authenticates `/api/cron/*` (ticket 13's reconciliation sweep).
   *
   * Not a session — the caller is a scheduler, not a person. Optional so local
   * development boots without one; the route refuses to run when it is unset
   * rather than running unauthenticated, because a reconciliation endpoint
   * anyone can trigger is a way to hammer three payment providers.
   */
  CRON_SECRET: z.string().min(16).optional(),

  /* ── AI (ticket 16) — via OpenRouter ────────────────────
     OpenRouter is an OpenAI-compatible gateway, so ticket 16 uses the OpenAI
     SDK pointed at this baseURL rather than a vendor SDK. Model ids are
     "vendor/model", so Claude stays reachable — just not called directly. */
  OPENROUTER_API_KEY: z.string().startsWith("sk-or-").optional(),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-opus-4.1"),
  OPENROUTER_SITE_URL: z.url().optional(),
  OPENROUTER_APP_NAME: z.string().default("Innovatrix"),

  /* ── Email (ticket 24) ────────────────────────────────── */
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.email().default("no-reply@innovatrix.com"),

  /* ── Jobs (ticket 25) ─────────────────────────────────── */
  CRON_SECRET: z.string().min(16).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function loadServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  • ${i.path.join(".") || "(root)"} — ${i.message}`,
    );
    throw new Error(
      `Invalid server environment.\n\n${lines.join("\n")}\n\n` +
        `Copy .env.example to .env.local and fill in the values above.\n`,
    );
  }

  const env = parsed.data;

  // Cross-field rules the schema can't express on its own.
  if (
    env.AUTH_GOOGLE_ENABLED &&
    (!env.AUTH_GOOGLE_CLIENT_ID || !env.AUTH_GOOGLE_CLIENT_SECRET)
  ) {
    throw new Error(
      "AUTH_GOOGLE_ENABLED is true but AUTH_GOOGLE_CLIENT_ID / AUTH_GOOGLE_CLIENT_SECRET are missing.",
    );
  }
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) {
    throw new Error(
      "STRIPE_SECRET_KEY is set without STRIPE_WEBHOOK_SECRET. " +
        "Unverified webhooks must never reach fulfilment (§87).",
    );
  }
  // The point of this rule is "never ship an http URL to real users" — and
  // localhost is never a real user. Without the exemption, `next start` (which
  // always sets NODE_ENV=production) cannot run locally at all, which is
  // exactly when you most want to smoke-test a production build.
  if (
    env.NODE_ENV === "production" &&
    env.APP_URL.startsWith("http://") &&
    !isLocalhost(env.APP_URL)
  ) {
    throw new Error(
      `APP_URL must use https in production (got "${env.APP_URL}"). ` +
        `http is permitted only for localhost.`,
    );
  }

  return env;
}

/**
 * Lazily validated so that importing a module which touches config does not
 * crash tooling (codemods, type generation) that has no environment loaded.
 */
let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  return (cached ??= loadServerEnv());
}

/** Call once at boot (instrumentation.ts) to fail fast rather than on first request. */
export function assertServerEnv(): void {
  serverEnv();
}

/** Which payment providers are actually usable, given the keys present. */
export function configuredPaymentProviders(): Array<"stripe" | "paystack" | "paypal"> {
  const env = serverEnv();
  const providers: Array<"stripe" | "paystack" | "paypal"> = [];
  if (env.STRIPE_SECRET_KEY) providers.push("stripe");
  if (env.PAYSTACK_SECRET_KEY) providers.push("paystack");
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) providers.push("paypal");
  return providers;
}

function isLocalhost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Whether cookies should carry the `Secure` flag.
 *
 * Derived from the **scheme actually being served**, not from `NODE_ENV`. A
 * production build running on http://localhost would otherwise issue `Secure`
 * cookies that the browser silently drops — every sign-in appearing to succeed
 * and no session surviving the redirect.
 */
export const usesSecureCookies = () => serverEnv().APP_URL.startsWith("https://");

export const isProduction = () => serverEnv().NODE_ENV === "production";
export const isDevelopment = () => serverEnv().NODE_ENV === "development";
