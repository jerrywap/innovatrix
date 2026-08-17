import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Does any server secret reach the browser? — §88, ticket 26.
 *
 * `npm run scan:bundle` (after `npm run build`).
 *
 * ## Why grep the output rather than trust the boundary
 *
 * The boundary is good: `src/config/env.ts` imports `server-only`, so pulling
 * it into a Client Component is a build error rather than a leak. Forty modules
 * carry the same marker.
 *
 * That is exactly why this exists. Everything that would catch the mistake
 * lives *upstream* of the artefact, and the artefact is the only thing that
 * actually ships. A `NEXT_PUBLIC_` typo, a value interpolated into a prop, a
 * dependency that logs its config — none of those trip `server-only`, and all
 * of them end up in a chunk. Reading the bytes is the one check that cannot be
 * fooled by reasoning about the code.
 *
 * ## Two passes
 *
 * **Patterns** — known key shapes (`sk_live_`, `whsec_`, `sk-or-`, …). Catches a
 * key from any source, including one somebody pasted into a component.
 *
 * **Literals** — the actual values in this machine's environment. Catches a
 * secret whose shape we do not recognise, which is most of them: `AUTH_SECRET`
 * and `ENCRYPTION_KEY` are just random bytes and no pattern would find them.
 * Skips anything under 12 characters, because a short "secret" would match
 * half the minified bundle and produce noise instead of a signal.
 *
 * A finding is **never printed**. It names the variable and the file; printing
 * the match would copy the secret into CI logs, which is the problem rather
 * than the report.
 */

const BUNDLE_DIRS = [
  join(process.cwd(), ".next", "static"),
  // Server chunks are not shipped to a browser, but this catches a secret
  // baked into a *page*'s serialised props, which are.
  join(process.cwd(), ".next", "server", "app"),
];

/** Key shapes worth recognising wherever they come from. */
const PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Stripe live secret key", pattern: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { name: "Stripe test secret key", pattern: /\bsk_test_[A-Za-z0-9]{16,}/ },
  { name: "Stripe webhook secret", pattern: /\bwhsec_[A-Za-z0-9]{16,}/ },
  { name: "Paystack secret key", pattern: /\bsk_(?:live|test)_[a-f0-9]{32,}/ },
  { name: "OpenRouter key", pattern: /\bsk-or-v1-[A-Za-z0-9]{20,}/ },
  { name: "Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9-]{20,}/ },
  { name: "OpenAI key", pattern: /\bsk-proj-[A-Za-z0-9-]{20,}/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private key block", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  {
    name: "MongoDB connection string with credentials",
    pattern: /mongodb(?:\+srv)?:\/\/[^\s:]+:[^\s@]+@/,
  },
];

/**
 * Environment variables whose *values* must never appear.
 *
 * `NEXT_PUBLIC_*` are excluded by definition — they are inlined on purpose.
 */
const SECRET_VARS = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_CLIENT_SECRET",
  "ENCRYPTION_KEY",
  "ENCRYPTION_KEYS_PREVIOUS",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PAYSTACK_SECRET_KEY",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "OPENROUTER_API_KEY",
  "RESEND_API_KEY",
  "SMTP_PASSWORD",
  "CRON_SECRET",
  "MONGODB_URI",
];

/** Below this, a "secret" matches too much minified output to mean anything. */
const MIN_LITERAL_LENGTH = 12;

interface Finding {
  file: string;
  what: string;
}

function main(): void {
  const files = BUNDLE_DIRS.flatMap((dir) => walk(dir));

  if (files.length === 0) {
    console.error(
      "No build output found. Run `npm run build` first — a scan of nothing " +
        "passes, which is the one result this must never report by accident.",
    );
    process.exit(1);
  }

  const literals = SECRET_VARS.map((name) => ({ name, value: process.env[name] })).filter(
    (entry): entry is { name: string; value: string } => {
      return Boolean(entry.value && entry.value.length >= MIN_LITERAL_LENGTH);
    },
  );

  const findings: Finding[] = [];

  for (const file of files) {
    const contents = readFileSync(file, "utf8");

    for (const { name, pattern } of PATTERNS) {
      if (pattern.test(contents)) findings.push({ file: rel(file), what: name });
    }

    for (const { name, value } of literals) {
      if (contents.includes(value)) {
        findings.push({ file: rel(file), what: `the value of ${name}` });
      }
    }
  }

  console.log(
    `scanned ${files.length} file(s) · ${PATTERNS.length} pattern(s) · ` +
      `${literals.length} environment value(s)`,
  );

  if (literals.length === 0) {
    console.warn(
      "\n⚠ No secret values were available to check against. Run with " +
        "`--env-file=.env.local` or the literal pass proves nothing.",
    );
  }

  if (findings.length === 0) {
    console.log("\n✓ nothing found");
    return;
  }

  console.error(`\n✗ ${findings.length} finding(s):\n`);
  for (const finding of findings) {
    // The match itself is never printed — see the note at the top.
    console.error(`  ${finding.file}\n    contains ${finding.what}`);
  }
  process.exit(1);
}

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(js|mjs|cjs|json|txt|html|rsc)$/.test(entry) ? [full] : [];
  });
}

function rel(file: string): string {
  return file.replace(`${process.cwd()}/`, "");
}

main();
