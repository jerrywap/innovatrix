import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { PaymentTerms, QuoteStatus } from "@/lib/db/enums";
import { Quote, type QuoteDoc, type QuoteItem } from "@/lib/db/models/billing";
import { Organization } from "@/lib/db/models/identity";
import { CustomerRequest } from "@/lib/db/models/requests";
import { balanceAmount, depositAmount } from "@/services/quotes/totals";
import { orgFilter } from "@/lib/auth/scope";

/**
 * Reading a quote — §51.
 *
 * ## `actionable` is computed from the date, not the status
 *
 * A quote whose expiry has passed but which the ticket-25 sweep has not yet
 * marked `expired` still reads `issued`. Rendering Accept on it would offer a
 * button the service then refuses — so this decides the same way
 * `quote-service.accept` does, and the screen and the service cannot disagree.
 */

export interface QuoteView {
  id: string;
  reference: string;
  version: number;
  status: QuoteStatus;
  title: string;
  scope?: string;
  deliverables: string[];
  exclusions: string[];
  notes?: string;
  items: QuoteItem[];
  currency: string;
  subtotal: number;
  discount?: number;
  tax?: { basisPoints?: number; amount: number };
  total: number;
  paymentTerms: PaymentTerms;
  /** Split out for the customer, so terms are a figure rather than a percentage. */
  deposit?: { amount: number; balance: number; percent: number };
  estimatedStart?: string;
  estimatedDurationDays?: number;
  expiresAt: string;
  expired: boolean;
  /** Issued, in date, and not yet answered. */
  actionable: boolean;
  issuedAt?: string;
  acceptedAt?: string;
  acceptedVersion?: number;
  rejectionReason?: string;
  organizationName: string;
  requestReference?: string;
  /** Earlier versions, newest first. §51 — the customer may view prior ones. */
  history: Array<{ id: string; version: number; total: number; status: QuoteStatus }>;
}

/** What each state means and whose move it is — §3, never leave them guessing. */
export const QUOTE_STATUS_COPY: Record<QuoteStatus, { what: string; next: string }> = {
  draft: {
    what: "This quote hasn't been sent yet.",
    next: "It'll appear here once we send it.",
  },
  issued: {
    what: "We've sent you this quote.",
    next: "Have a read. Accept it, decline it, or ask us anything first.",
  },
  accepted: {
    what: "You accepted this quote.",
    next: "We'll raise the invoice and get the work scheduled.",
  },
  rejected: {
    what: "You declined this quote.",
    next: "Tell us what didn't work and we'll look at it again.",
  },
  expired: {
    what: "This quote has expired.",
    next: "Ask us for a fresh one — prices and timings may have moved.",
  },
  superseded: {
    what: "We've replaced this with a newer version.",
    next: "Look at the current version instead.",
  },
};

export async function loadQuote(
  quoteId: string,
  scope: { organizationId?: string },
): Promise<QuoteView | null> {
  await connectToDatabase();

  const quote = await Quote.findOne({
    _id: toObjectId(quoteId),
    // Staff omit the organisation and see across all of them (§30). A blank
    // string is a caller bug and throws — see `orgFilter`.
    ...orgFilter(scope),
  }).lean<QuoteDoc>();

  if (!quote) return null;

  const [organization, request, history] = await Promise.all([
    Organization.findById(quote.organizationId).select({ name: 1 }).lean<{ name: string }>(),
    CustomerRequest.findById(quote.requestId)
      .select({ reference: 1 })
      .lean<{ reference: string }>(),
    Quote.find({ reference: quote.reference, _id: { $ne: quote._id } })
      .sort({ version: -1 })
      .select({ version: 1, total: 1, status: 1 })
      .lean<
        Array<{ _id: unknown; version: number; total: { amount: number }; status: QuoteStatus }>
      >(),
  ]);

  const expired = quote.expiresAt.getTime() <= Date.now();

  return {
    id: String(quote._id),
    reference: quote.reference,
    version: quote.version,
    status: quote.status,
    title: quote.title,
    ...(quote.scope ? { scope: quote.scope } : {}),
    deliverables: quote.deliverables,
    exclusions: quote.exclusions,
    ...(quote.notes ? { notes: quote.notes } : {}),
    items: quote.items,
    currency: quote.currency,
    subtotal: quote.subtotal.amount,
    ...(quote.discount?.amount ? { discount: quote.discount.amount } : {}),
    ...(quote.tax?.amount
      ? {
          tax: {
            ...(quote.tax.basisPoints ? { basisPoints: quote.tax.basisPoints } : {}),
            amount: quote.tax.amount,
          },
        }
      : {}),
    total: quote.total.amount,
    paymentTerms: quote.paymentTerms,
    ...(quote.paymentTerms === "deposit_balance" && quote.depositBasisPoints
      ? {
          deposit: {
            amount: depositAmount(quote.total.amount, quote.depositBasisPoints),
            balance: balanceAmount(quote.total.amount, quote.depositBasisPoints),
            percent: quote.depositBasisPoints / 100,
          },
        }
      : {}),
    ...(quote.estimatedStart ? { estimatedStart: isoDay(quote.estimatedStart) } : {}),
    ...(quote.estimatedDurationDays
      ? { estimatedDurationDays: quote.estimatedDurationDays }
      : {}),
    expiresAt: isoDay(quote.expiresAt),
    expired,
    // Both conditions, and the date is one of them — see the note above.
    actionable: quote.status === "issued" && !expired,
    ...(quote.issuedAt ? { issuedAt: isoDay(quote.issuedAt) } : {}),
    ...(quote.acceptedAt ? { acceptedAt: isoDay(quote.acceptedAt) } : {}),
    ...(quote.acceptedQuoteVersion ? { acceptedVersion: quote.acceptedQuoteVersion } : {}),
    ...(quote.rejectionReason ? { rejectionReason: quote.rejectionReason } : {}),
    organizationName: organization?.name ?? "Unknown",
    ...(request?.reference ? { requestReference: request.reference } : {}),
    history: history.map((row) => ({
      id: String(row._id),
      version: row.version,
      total: row.total.amount,
      status: row.status,
    })),
  };
}

export interface ListedQuote {
  id: string;
  reference: string;
  version: number;
  title: string;
  status: QuoteStatus;
  total: number;
  currency: string;
  expiresAt: string;
  actionable: boolean;
}

export async function listQuotesForOrganization(
  organizationId: string,
): Promise<ListedQuote[]> {
  await connectToDatabase();

  const rows = await Quote.find({
    organizationId: toObjectId(organizationId),
    // A draft is ours until we send it. Showing it would let a customer read a
    // price nobody has decided to offer them.
    status: { $ne: "draft" },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean<QuoteDoc[]>();

  const now = Date.now();

  return rows.map((row) => ({
    id: String(row._id),
    reference: row.reference,
    version: row.version,
    title: row.title,
    status: row.status,
    total: row.total.amount,
    currency: row.currency,
    expiresAt: isoDay(row.expiresAt),
    actionable: row.status === "issued" && row.expiresAt.getTime() > now,
  }));
}

/** Quotes on one request, for the staff workspace. Drafts included. */
export async function listQuotesForRequest(requestId: string): Promise<ListedQuote[]> {
  await connectToDatabase();

  const rows = await Quote.find({ requestId: toObjectId(requestId) })
    .sort({ version: -1 })
    .lean<QuoteDoc[]>();

  const now = Date.now();

  return rows.map((row) => ({
    id: String(row._id),
    reference: row.reference,
    version: row.version,
    title: row.title,
    status: row.status,
    total: row.total.amount,
    currency: row.currency,
    expiresAt: isoDay(row.expiresAt),
    actionable: row.status === "issued" && row.expiresAt.getTime() > now,
  }));
}

function isoDay(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}
