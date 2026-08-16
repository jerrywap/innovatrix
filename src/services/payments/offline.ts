import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import { PaymentSettings, type PaymentSettingsDoc } from "@/lib/db/models/commerce";

/**
 * Paying by bank transfer — the customer-facing half.
 *
 * ## Availability is "are the instructions written down", not a feature flag
 *
 * Offering to take a transfer without saying where to send it is worse than not
 * offering at all: the customer places an order, waits for details that never
 * arrive, and eventually emails to ask. So the option appears only when
 * somebody has actually written the bank details into `/admin/settings/payments`.
 *
 * That also means the switch has an obvious off position — clear the
 * instructions, or untick the flag — rather than needing a deploy.
 */

export interface OfflineAvailability {
  available: boolean;
  /** Bank details, as entered. Safe to show a customer; not a secret. */
  instructions?: string;
}

export async function offlinePaymentAvailability(): Promise<OfflineAvailability> {
  await connectToDatabase();

  const settings = await PaymentSettings.findOne({ singleton: "global" })
    .select({ offlineEnabled: 1, offlineInstructions: 1 })
    .lean<Pick<PaymentSettingsDoc, "offlineEnabled" | "offlineInstructions">>();

  // No row at all ⇒ nothing configured ⇒ not offered. An empty database should
  // not silently start accepting orders nobody can pay.
  if (!settings) return { available: false };

  const instructions = settings.offlineInstructions?.trim();
  if (settings.offlineEnabled === false || !instructions) return { available: false };

  return { available: true, instructions };
}
