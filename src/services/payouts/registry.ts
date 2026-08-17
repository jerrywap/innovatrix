import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import {
  DEFAULT_PAYOUT_CADENCE_DAYS,
  DEFAULT_PAYOUT_THRESHOLD_MINOR,
  PaymentSettings,
} from "@/lib/db/models/commerce";
import { ValidationError } from "@/lib/errors";
import { money, type CurrencyCode, type Money } from "@/lib/money";
import { ManualPayoutDriver } from "./drivers/manual";
import type { PayoutProviderDriver } from "./provider";

/**
 * Which driver sends a payout, and on what terms — vendor ticket 09.
 *
 * The same shape as `payments/registry.ts`, so adding an automated transfer provider is
 * implementing the interface and adding a line here. This module is the only place that
 * names a driver, which is what makes that true.
 */

const DRIVERS: Record<string, PayoutProviderDriver> = {
  manual: new ManualPayoutDriver(),
};

/** The method a payout uses when nothing else is chosen. */
export const DEFAULT_PAYOUT_METHOD = "manual";

export function payoutDriverFor(key: string): PayoutProviderDriver {
  const driver = DRIVERS[key];
  if (!driver) {
    // A payout row naming a driver that no longer exists. Loud, because the alternative is
    // a payout that can never leave `approved` and nobody knowing why.
    throw new ValidationError(`No payout driver named "${key}".`, {
      method: [`Known methods: ${Object.keys(DRIVERS).join(", ")}.`],
    });
  }
  return driver;
}

export function allPayoutDrivers(): PayoutProviderDriver[] {
  return Object.values(DRIVERS);
}

/* ────────────────────────────────────────────── terms */

/**
 * The least a vendor's cleared balance may be before a payout drafts.
 *
 * Per currency and never converted — a single number cannot serve GBP and NGN, and choosing
 * a rate to make it would be an FX decision nobody took (decision **V5**).
 */
export async function payoutThreshold(currency: CurrencyCode): Promise<Money> {
  await connectToDatabase();

  const settings = await PaymentSettings.findOne({ singleton: "global" })
    .select({ payoutThresholds: 1 })
    .lean<{ payoutThresholds?: { currency: string; amount: number }[] }>();

  const configured = settings?.payoutThresholds?.find((row) => row.currency === currency);
  return money(configured?.amount ?? DEFAULT_PAYOUT_THRESHOLD_MINOR, currency);
}

/** How many days a payout period covers — decision **V3**. */
export async function payoutCadenceDays(): Promise<number> {
  await connectToDatabase();

  const settings = await PaymentSettings.findOne({ singleton: "global" })
    .select({ payoutCadenceDays: 1 })
    .lean<{ payoutCadenceDays?: number }>();

  return settings?.payoutCadenceDays ?? DEFAULT_PAYOUT_CADENCE_DAYS;
}

/**
 * The period a batch drafted at `now` covers.
 *
 * A rolling window ending now, rather than a calendar month. "The 1st" needs a timezone
 * argument nobody has settled and produces a period whose length changes in February; a
 * rolling cadence needs neither and is what the unique `(vendorId, periodStart, periodEnd)`
 * index keys on.
 *
 * Normalised to whole days — the boundaries are what the index dedupes on, so a batch run
 * twice in one day must produce the *same* period rather than two that differ by minutes.
 */
export function payoutPeriod(now: Date, cadenceDays: number): { start: Date; end: Date } {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const start = new Date(end.getTime() - cadenceDays * 24 * 60 * 60 * 1000);
  return { start, end };
}
