import "server-only";
import type { PayoutStatus, PayoutSkipReason } from "@/lib/db/enums";
import type { PayoutDoc } from "@/lib/db/models/ledger";
import { isCurrencyCode, money, type Money } from "@/lib/money";

/**
 * Payout rows for a screen — vendor ticket 09.
 *
 * A projection rather than the document, for the usual reason plus one specific to this
 * ticket: `PayoutDoc` carries `evidenceKey`, and a storage key crossing the RSC boundary is a
 * key in the page payload. Nothing here has one — the evidence is reached through the
 * authorised route, by id.
 */

export interface PayoutRow {
  id: string;
  reference: string;
  vendorId: string;
  status: PayoutStatus;
  method: string;
  amount: Money;
  periodStart: Date;
  periodEnd: Date;
  paidAt?: Date;
  externalReference?: string;
  failureReason?: string;
  hasEvidence: boolean;
  entryCount: number;
  createdAt: Date;
}

export function toPayoutRow(payout: PayoutDoc): PayoutRow {
  const currency = payout.amount.currency;

  return {
    id: String(payout._id),
    reference: payout.reference,
    vendorId: String(payout.vendorId),
    status: payout.status,
    method: payout.method,
    // `MoneySchema` validated the currency on the way in, so the fallback is unreachable
    // rather than defensive — but a `money()` throw inside a list loader would take a whole
    // screen down, and a zero in an impossible currency is not a figure anybody would act on.
    amount: isCurrencyCode(currency) ? money(payout.amount.amount, currency) : money(0, "GBP"),
    periodStart: payout.periodStart,
    periodEnd: payout.periodEnd,
    ...(payout.paidAt ? { paidAt: payout.paidAt } : {}),
    ...(payout.externalReference ? { externalReference: payout.externalReference } : {}),
    ...(payout.failureReason ? { failureReason: payout.failureReason } : {}),
    // A boolean, never the key.
    hasEvidence: Boolean(payout.evidenceKey),
    entryCount: payout.entryIds.length,
    createdAt: payout.createdAt,
  };
}

/**
 * What each status means, in the second person, for the vendor's screen.
 *
 * Written for somebody asking "where is my money", which is the only reason this screen is
 * ever opened. A status badge alone answers a different question — what the record says —
 * and leaves the useful one to support.
 */
export const PAYOUT_STATUS_COPY: Record<PayoutStatus, string> = {
  draft: "Prepared, waiting for us to release it. Nothing for you to do.",
  approved: "Released for payment. The transfer goes out on our next banking run.",
  sending: "The transfer is with the bank. It usually lands within a few working days.",
  paid: "Sent. The reference below is what your bank statement will show.",
  failed: "The transfer did not go through. We will try again — check your account details.",
  cancelled: "Cancelled. The earnings went back into your balance for the next run.",
};

/**
 * Why a vendor was passed over, in words they can act on.
 *
 * Each one says what would change it. "Below threshold" without the number, or "unverified"
 * without a link, is a message that produces a support email rather than an action.
 */
export const SKIP_REASON_COPY: Record<PayoutSkipReason, { what: string; next: string }> = {
  unverified: {
    what: "We could not pay you because your business verification is not complete.",
    next: "Upload your business documents and we will review them.",
  },
  no_account: {
    what: "We could not pay you because there are no payout details on your account.",
    next: "Your account owner can add them in Selling settings.",
  },
  below_threshold: {
    what: "Your balance was below the minimum for a payout.",
    next: "It stays in your balance and rolls into the next run — nothing is lost.",
  },
  negative_balance: {
    what: "Your balance was negative, usually after a refund.",
    next: "Future earnings clear it first, then payouts resume.",
  },
  suspended: {
    what: "Payouts are paused while your account is suspended.",
    next: "Whatever we asked you about needs resolving first.",
  },
};
