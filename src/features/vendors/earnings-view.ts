import "server-only";
import { LEDGER_ENTRY_KINDS, type LedgerEntryKind } from "@/lib/db/enums";
import { isCurrencyCode, money, type Money } from "@/lib/money";
import { formatRate, resolveCommissionForVendor } from "@/services/vendors/commission-service";
import {
  CLEARANCE_DAYS,
  REFUND_WINDOW_DAYS,
  balanceFor,
  listEntries,
  type LedgerRow,
} from "@/services/vendors/ledger-service";

/**
 * What a vendor's earnings screen needs — vendor tickets 07 and 08.
 *
 * A loader rather than four awaits in the page, for the reason the other `*-view.ts`
 * files exist: the page renders, and the shape a screen needs is a decision worth
 * testing on its own.
 *
 * ## The rate is shown, not just applied
 *
 * A revenue share the vendor cannot see is a revenue share they have to take on trust.
 * So the effective rate and **where it came from** both cross the boundary: a vendor on
 * a negotiated rate should be able to see that it is theirs rather than everybody's.
 */

export interface EarningsBalance {
  currency: string;
  /** Earned, not yet clear of the refund window. */
  pending: Money;
  /** Payable. */
  cleared: Money;
  /** Already paid out. */
  paid: Money;
}

export interface EarningsView {
  rate: { basisPoints: number; label: string; source: "platform" | "vendor" };
  /** The kind currently filtered on, echoed back so the screen can mark the chip. */
  kind?: LedgerEntryKind;
  clearanceDays: number;
  refundWindowDays: number;
  balances: EarningsBalance[];
  entries: LedgerRow[];
}

/**
 * A `kind` from the query string, or undefined.
 *
 * Everything from a URL is untrusted, so an unrecognised value becomes "no filter" rather
 * than reaching the query — the same position `parseListParams` takes on a sort column the
 * screen never declared.
 */
export function parseKind(raw: string | undefined): LedgerEntryKind | undefined {
  return (LEDGER_ENTRY_KINDS as readonly string[]).includes(raw ?? "")
    ? (raw as LedgerEntryKind)
    : undefined;
}

export async function loadEarnings(
  vendorId: string,
  options: { kind?: LedgerEntryKind } = {},
): Promise<EarningsView> {
  const [rate, rawBalances, entries] = await Promise.all([
    resolveCommissionForVendor(vendorId),
    // The balances are **never** filtered by kind. A "pending" figure that changed when
    // somebody clicked a filter would be a different number wearing the same label.
    balanceFor({ vendorId }),
    listEntries({ vendorId }, { limit: 50, ...(options.kind ? { kind: options.kind } : {}) }),
  ]);

  return {
    ...(options.kind ? { kind: options.kind } : {}),
    rate: {
      basisPoints: rate.basisPoints,
      label: formatRate(rate.basisPoints),
      source: rate.source,
    },
    clearanceDays: CLEARANCE_DAYS,
    refundWindowDays: REFUND_WINDOW_DAYS,
    balances: rawBalances
      // A currency the ledger holds but `money.ts` does not know cannot be formatted, and
      // guessing an exponent for it would misstate an amount. Dropping the row is wrong
      // too — so this cannot happen, and `MoneySchema` is what makes that true: the
      // currency was validated on the way in.
      .filter((balance) => isCurrencyCode(balance.currency))
      .map((balance) => ({
        currency: balance.currency,
        pending: money(balance.pending, balance.currency as never),
        cleared: money(balance.cleared, balance.currency as never),
        paid: money(balance.paid, balance.currency as never),
      })),
    entries,
  };
}
