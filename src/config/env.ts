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

  /* ── Auth (ticket 03) ─────────────────────────────────── */
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_GOOGLE_ENABLED: bool.default(false),
  AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),

  /* ── Object storage (ticket 05) ─────────────────────────
     STORAGE_ENDPOINT is the provider switch: absent ⇒ AWS S3 (host derived
     from region, virtual-hosted addressing); present ⇒ S3-compatible
     (R2/MinIO, path-style addressing). An R2 endpoint left in place while the
     bucket is on AWS sends every request to the wrong host, so an empty string
     is normalised to undefined rather than failing URL validation. */
  STORAGE_ENDPOINT: z
    .string()
    .transform((v) => (v.trim() === "" ? undefined : v.trim()))
    .pipe(z.url().optional())
    .optional(),
  STORAGE_REGION: z.string().min(1).default("us-east-1"),
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

  /* ── Payments (ticket 12) — keys live here, never in the database ── */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),

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
  if (env.NODE_ENV === "production" && env.APP_URL.startsWith("http://")) {
    throw new Error("APP_URL must use https in production.");
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

export const isProduction = () => serverEnv().NODE_ENV === "production";
export const isDevelopment = () => serverEnv().NODE_ENV === "development";
