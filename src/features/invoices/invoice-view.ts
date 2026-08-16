import "server-only";
import type { QueryFilter } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { InvoiceStatus } from "@/lib/db/enums";
import { Invoice, Quote, type InvoiceDoc, type QuoteItem } from "@/lib/db/models/billing";
import { Organization } from "@/lib/db/models/identity";
import { Payment, type PaymentDoc } from "@/lib/db/models/commerce";
import { CustomerRequest } from "@/lib/db/models/requests";
import { outstanding } from "@/services/invoices/invoice-service";
import { orgFilter } from "@/lib/auth/scope";

/**
 * Reading an invoice — §63.
 *
 * ## `overdue` is computed, not waited for
 *
 * An invoice past its due date still reads `issued` until ticket 25's sweep
 * runs. A customer looking at a screen that says "issued" on something three
 * weeks late is being misled by our cron schedule, so the view derives it from
 * the date — exactly as `quote-view` derives `expired`.
 *
 * The stored status is left alone: it is what the dunning process acts on, and
 * a read must not have write side effects.
 */

export interface InvoiceLine {
  kind: QuoteItem["kind"];
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoicePaymentRow {
  id: string;
  reference: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  paidAt?: string;
  /** Whether a receipt is attached — never the key itself. */
  hasEvidence: boolean;
}

export interface InvoiceView {
  id: string;
  reference: string;
  status: InvoiceStatus;
  /** What the customer should be told, date included. */
  effectiveStatus: InvoiceStatus;
  portion: "full" | "deposit" | "balance";
  items: InvoiceLine[];
  currency: string;
  subtotal: number;
  tax?: { basisPoints?: number; amount: number };
  total: number;
  amountPaid: number;
  outstanding: number;
  payable: boolean;
  issuedAt?: string;
  dueAt?: string;
  paidAt?: string;
  overdue: boolean;
  organizationId: string;
  organizationName: string;
  sourceType: InvoiceDoc["sourceType"];
  sourceId: string;
  /**
   * The quote this was raised from, when there is one. `requestReference` is
   * how staff get back to the workspace — there is no standalone staff quote
   * route, and `typedRoutes` would refuse a link to one that doesn't exist.
   */
  quote?: {
    id: string;
    reference: string;
    version: number;
    title: string;
    requestReference?: string;
  };
  /**
   * The balance on deposit terms has not been raised yet — §63's second
   * invoice, which staff trigger because nothing else knows the work is done.
   */
  balanceRaisable: boolean;
  payments: InvoicePaymentRow[];
}

/** What each state means and whose move it is — §3. */
export const INVOICE_STATUS_COPY: Record<InvoiceStatus, { what: string; next: string }> = {
  draft: {
    what: "This invoice hasn't been issued yet.",
    next: "It'll appear here once we send it.",
  },
  issued: {
    what: "This invoice is due.",
    next: "Pay by card, or by transfer using the details below.",
  },
  partially_paid: {
    what: "We've received part of this.",
    next: "The balance below is still outstanding.",
  },
  paid: { what: "This invoice is paid in full.", next: "Nothing more to do — thank you." },
  overdue: {
    what: "This invoice is past its due date.",
    next: "Pay it now, or tell us if something's wrong and we'll sort it out.",
  },
  cancelled: { what: "We cancelled this invoice.", next: "You don't owe anything on it." },
  refunded: { what: "This invoice was refunded.", next: "The money is back with you." },
};

const PAYABLE: InvoiceStatus[] = ["issued", "partially_paid", "overdue"];

export async function loadInvoice(
  invoiceId: string,
  scope: { organizationId?: string },
): Promise<InvoiceView | null> {
  await connectToDatabase();

  const invoice = await Invoice.findOne({
    _id: toObjectId(invoiceId),
    // Staff omit the organisation and see across all of them (§30). A blank
    // string is a caller bug and throws — see `orgFilter`.
    ...orgFilter(scope),
  }).lean<InvoiceDoc>();

  if (!invoice) return null;

  const [organization, quote, paymentRows, balanceExists] = await Promise.all([
    Organization.findById(invoice.organizationId).select({ name: 1 }).lean<{ name: string }>(),
    invoice.sourceType === "quote"
      ? Quote.findById(invoice.sourceId)
          .select({ reference: 1, version: 1, title: 1, requestId: 1 })
          .lean<{
            _id: unknown;
            reference: string;
            version: number;
            title: string;
            requestId: unknown;
          }>()
      : null,
    Payment.find({ subjectType: "invoice", subjectId: invoice._id })
      .sort({ createdAt: -1 })
      .lean<PaymentDoc[]>(),
    invoice.portion === "deposit"
      ? Invoice.exists({
          sourceType: "quote",
          sourceId: invoice.sourceId,
          portion: "balance",
        })
      : null,
  ]);

  const request = quote
    ? await CustomerRequest.findById(quote.requestId)
        .select({ reference: 1 })
        .lean<{ reference: string }>()
    : null;

  const due = outstanding(invoice);
  const overdue =
    due > 0 && invoice.dueAt !== undefined && invoice.dueAt.getTime() < Date.now();

  return {
    id: String(invoice._id),
    reference: invoice.reference,
    status: invoice.status,
    // The stored status unless the date says otherwise — see the note above.
    effectiveStatus: overdue && PAYABLE.includes(invoice.status) ? "overdue" : invoice.status,
    portion: invoice.portion ?? "full",
    items: invoice.items.map((item) => ({
      kind: item.kind,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice.amount,
      lineTotal: item.lineTotal.amount,
    })),
    currency: invoice.currency,
    subtotal: invoice.subtotal.amount,
    ...(invoice.tax?.amount
      ? {
          tax: {
            ...(invoice.tax.basisPoints ? { basisPoints: invoice.tax.basisPoints } : {}),
            amount: invoice.tax.amount,
          },
        }
      : {}),
    total: invoice.total.amount,
    amountPaid: invoice.amountPaid.amount,
    outstanding: due,
    payable: PAYABLE.includes(invoice.status) && due > 0,
    ...(invoice.issuedAt ? { issuedAt: isoDay(invoice.issuedAt) } : {}),
    ...(invoice.dueAt ? { dueAt: isoDay(invoice.dueAt) } : {}),
    ...(invoice.paidAt ? { paidAt: isoDay(invoice.paidAt) } : {}),
    overdue,
    organizationId: String(invoice.organizationId),
    organizationName: organization?.name ?? "Unknown",
    sourceType: invoice.sourceType,
    sourceId: String(invoice.sourceId),
    ...(quote
      ? {
          quote: {
            id: String(quote._id),
            reference: quote.reference,
            version: quote.version,
            title: quote.title,
            ...(request?.reference ? { requestReference: request.reference } : {}),
          },
        }
      : {}),
    // Offered only once the deposit is settled: raising a balance for work that
    // has not been funded to start would put a second invoice in the overdue
    // queue for the same reason the balance is not raised at acceptance.
    balanceRaisable:
      invoice.portion === "deposit" && invoice.status === "paid" && !balanceExists,
    payments: paymentRows.map((row) => ({
      id: String(row._id),
      reference: row.reference,
      provider: row.provider,
      amount: row.amount.amount,
      currency: row.amount.currency,
      status: row.status,
      ...(row.paidAt ? { paidAt: isoDay(row.paidAt) } : {}),
      // A boolean, not a key. The key is only ever handed out by the
      // permission-checked evidence route.
      hasEvidence: Boolean(row.evidence?.storageKey),
    })),
  };
}

export interface ListedInvoice {
  id: string;
  reference: string;
  status: InvoiceStatus;
  effectiveStatus: InvoiceStatus;
  title: string;
  portion: "full" | "deposit" | "balance";
  total: number;
  outstanding: number;
  currency: string;
  dueAt?: string;
  overdue: boolean;
  payable: boolean;
  organizationName?: string;
}

/** The customer's list. */
export async function listInvoicesForOrganization(
  organizationId: string,
): Promise<ListedInvoice[]> {
  await connectToDatabase();

  const rows = await Invoice.find({
    organizationId: toObjectId(organizationId),
    // A draft invoice is ours until we issue it, the same way a draft quote is.
    status: { $ne: "draft" },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean<InvoiceDoc[]>();

  return summarise(rows);
}

/**
 * The staff list — every organisation's, oldest first.
 *
 * Oldest first because this is a work queue, not a record: the invoice that has
 * been unpaid longest is the one somebody needs to chase.
 */
export async function listInvoicesForStaff(filter?: {
  status?: InvoiceStatus | "unpaid";
}): Promise<ListedInvoice[]> {
  await connectToDatabase();

  const query: QueryFilter<InvoiceDoc> =
    filter?.status === "unpaid"
      ? { status: { $in: PAYABLE } }
      : filter?.status
        ? { status: filter.status }
        : { status: { $ne: "draft" } };

  const rows = await Invoice.find(query)
    .sort({ dueAt: 1, createdAt: 1 })
    .limit(200)
    .lean<InvoiceDoc[]>();

  const summaries = await summarise(rows);

  const names = await Organization.find({
    _id: { $in: rows.map((row) => row.organizationId) },
  })
    .select({ name: 1 })
    .lean<Array<{ _id: unknown; name: string }>>();

  const byId = new Map(names.map((row) => [String(row._id), row.name]));

  return summaries.map((row, index) => ({
    ...row,
    organizationName: byId.get(String(rows[index]!.organizationId)) ?? "Unknown",
  }));
}

/**
 * Titles come from the source quote in one query, not one per row.
 *
 * §94's habit. A hundred invoices is a hundred lookups otherwise, and the list
 * is exactly the screen somebody leaves open.
 */
async function summarise(rows: InvoiceDoc[]): Promise<ListedInvoice[]> {
  const quoteIds = rows.filter((row) => row.sourceType === "quote").map((row) => row.sourceId);

  const quotes = quoteIds.length
    ? await Quote.find({ _id: { $in: quoteIds } })
        .select({ title: 1 })
        .lean<Array<{ _id: unknown; title: string }>>()
    : [];

  const titles = new Map(quotes.map((row) => [String(row._id), row.title]));
  const now = Date.now();

  return rows.map((row) => {
    const due = outstanding(row);
    const overdue = due > 0 && row.dueAt !== undefined && row.dueAt.getTime() < now;

    return {
      id: String(row._id),
      reference: row.reference,
      status: row.status,
      effectiveStatus: overdue && PAYABLE.includes(row.status) ? "overdue" : row.status,
      title: titles.get(String(row.sourceId)) ?? `Order ${row.reference}`,
      portion: row.portion ?? "full",
      total: row.total.amount,
      outstanding: due,
      currency: row.currency,
      ...(row.dueAt ? { dueAt: isoDay(row.dueAt) } : {}),
      overdue,
      payable: PAYABLE.includes(row.status) && due > 0,
    };
  });
}

function isoDay(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}
