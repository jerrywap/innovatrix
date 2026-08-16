import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { isDomainError } from "@/lib/errors";
import type { CurrencyCode } from "@/lib/money";
import {
  getPaymentSettings,
  providersFor,
  resolveProvider,
} from "@/services/payments/registry";

/**
 * `npm run payments:probe [--live] [--currency=NGN]`
 *
 * Exercises the payment layer against the *real* configured credentials, which
 * nothing else does: the integration suite stubs every driver's HTTP, so a key
 * that is absent, wrong, or valid-but-not-provisioned-for-this-currency looks
 * identical to a working one until a customer tries to pay.
 *
 * Three stages, each answering a question the stage above cannot:
 *
 *   1. **settings** — which providers are enabled and configured at all.
 *   2. **routing**  — what `resolveProvider` picks per storefront currency,
 *                     and why it refuses when it does.
 *   3. **live**     — `--live` only: a real `initiate` call, reporting the
 *                     provider's own answer and, on failure, the *class* of
 *                     error. That last part is the point. "Something went wrong
 *                     on our side" means an unmodelled exception escaped, and
 *                     this prints which one.
 *
 * Read-only: no order, payment or audit row is written. The live stage creates
 * a transaction at the provider under a `PROBE-` reference and never pays it,
 * which is why it is opt-in and test-mode only.
 */

const args = process.argv.slice(2);
const live = args.includes("--live");
const only = args
  .find((a) => a.startsWith("--currency="))
  ?.split("=")[1]
  ?.toUpperCase();

function describeError(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const modelled = isDomainError(error)
    ? `modelled, code=${error.code}`
    : "UNMODELLED — reaches the customer as the generic message";
  const cause =
    error instanceof Error && error.cause
      ? `\n      cause: ${(error.cause as Error).message ?? String(error.cause)}`
      : "";
  return `${name}: ${message}\n      (${modelled})${cause}`;
}

async function main() {
  await connectToDatabase();

  /* ── 1. settings ─────────────────────────────────────── */

  const settings = await getPaymentSettings();

  console.log("\nSETTINGS");
  for (const provider of settings.providers) {
    const flags = [
      provider.enabled ? "enabled" : "disabled",
      provider.mode,
      provider.secretEnvVar ? `${provider.secretEnvVar}` : "no secret var",
    ];
    console.log(`  ${provider.key.padEnd(9)} ${flags.join(" · ")}`);
    console.log(
      `  ${" ".repeat(9)} declares: ${(provider.supportedCurrencies ?? []).join(", ") || "—"}`,
    );
  }

  console.log("\nROUTING (stored)");
  if (settings.currencyRouting.length === 0) {
    console.log("  none configured — resolution falls back to declaration order");
  }
  for (const route of settings.currencyRouting) {
    console.log(
      `  ${route.currency} → ${route.primary}${route.fallbacks?.length ? ` (then ${route.fallbacks.join(", ")})` : ""}`,
    );
  }

  /* ── 2. routing ──────────────────────────────────────── */

  const currencies = (only ? [only] : [...STOREFRONT_CURRENCIES]) as CurrencyCode[];

  console.log("\nRESOLUTION");
  for (const currency of currencies) {
    const candidates = await providersFor(currency);
    const names = candidates.map((c) => c.key).join(", ") || "none";
    console.log(`  ${currency}: candidates = ${names}`);

    try {
      const { key } = await resolveProvider(currency);
      console.log(`  ${" ".repeat(currency.length)}  chosen    = ${key}`);
    } catch (error) {
      console.log(`  ${" ".repeat(currency.length)}  refused   = ${describeError(error)}`);
    }
  }

  /* ── 3. live ─────────────────────────────────────────── */

  if (!live) {
    console.log("\nPass --live to attempt a real initiate against the provider.\n");
    return;
  }

  console.log("\nLIVE INITIATE");
  for (const currency of currencies) {
    let resolved;
    try {
      resolved = await resolveProvider(currency);
    } catch {
      console.log(`  ${currency}: skipped — no provider resolves`);
      continue;
    }

    const reference = `PROBE-${currency}-${Date.now()}`;

    try {
      const result = await resolved.driver.initiate({
        payment: { _id: new Types.ObjectId(), reference, subjectType: "order" },
        amount: { amount: 50_000, currency },
        customer: { email: "probe@example.com", organizationId: String(new Types.ObjectId()) },
        description: `Innovatrix probe ${reference}`,
        returnUrl: "http://localhost:3000/checkout/processing?order=PROBE",
        metadata: {},
      });
      console.log(`  ${currency}: ${resolved.key} OK → ${result.redirectUrl}`);
    } catch (error) {
      console.log(`  ${currency}: ${resolved.key} FAILED`);
      console.log(`      ${describeError(error)}`);
    }
  }

  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nprobe itself threw:", error);
    process.exit(1);
  });
