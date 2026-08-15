import { z } from "zod";

/**
 * Client-safe configuration.
 *
 * Everything here is inlined into the browser bundle at build time. Nothing
 * secret may ever be added to this file or to a NEXT_PUBLIC_ variable (§88).
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced as a full literal — Next.js
 * replaces these statically, so `process.env[key]` would silently be undefined.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("Innovatrix"),
  NEXT_PUBLIC_DEFAULT_CURRENCY: z.enum(["GBP", "USD", "EUR", "NGN"]).default("GBP"),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

const parsed = publicSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_DEFAULT_CURRENCY: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  • ${i.path.join(".")} — ${i.message}`);
  throw new Error(`Invalid public environment.\n\n${lines.join("\n")}\n`);
}

export const publicEnv = parsed.data;
export type PublicEnv = typeof publicEnv;
