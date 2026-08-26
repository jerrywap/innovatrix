import { Schema, type Types } from "mongoose";
import { MoneySchema, ORG_SCOPE_FIELD, referenceField, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  INVOICE_SOURCE_TYPES,
  INVOICE_STATUSES,
  PAYMENT_TERMS,
  QUOTE_ITEM_KINDS,
  QUOTE_STATUSES,
  type InvoiceSourceType,
  type InvoiceStatus,
  type PaymentTerms,
  type QuoteItemKind,
  type QuoteStatus,
} from "../enums";

/**
 * Quotes & invoices — §51 (quotes), §52 (quote → work), §63 (invoices),
 * §90 (audit).
 *
 * A quote is a commercial commitment, so two things are load-bearing:
 *   • **Exclusions are a first-class field**, not a paragraph in the notes.
 *     They are what prevents the scope dispute six weeks later.
 *   • **Acceptance is versioned.** `acceptedQuoteVersion` records which
 *     revision the customer actually agreed to, because a superseded quote is
 *     still evidence.
 */

/* ────────────────────────────────────────────── Quote */

/**
 * One line of a quote — §51.
 *
 * `lineTotal` is stored rather than derived on read. §61's habit: a quote is a
 * commercial commitment, and re-deriving a total at render time means a change
 * to the arithmetic silently changes what somebody already agreed to.
 */
export interface QuoteItem {
  kind: QuoteItemKind;
  description: string;
  quantity: number;
  unitPrice: { amount: number; currency: string };
  lineTotal: { amount: number; currency: string };
}

const quoteItemSchema = new Schema<QuoteItem>(
  {
    kind: { type: String, enum: QUOTE_ITEM_KINDS, required: true },
    description: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: MoneySchema, required: true },
    lineTotal: { type: MoneySchema, required: true },
  },
  { _id: false },
);

export interface QuoteDoc {
  _id: Types.ObjectId;
  reference: string;
  version: number;
  supersedesQuoteId?: Types.ObjectId;
  organizationId: Types.ObjectId;
  requestId: Types.ObjectId;
  title: string;
  scope?: string;
  deliverables: string[];
  exclusions: string[];
  notes?: string;
  items: QuoteItem[];
  currency: string;
  subtotal: { amount: number; currency: string };
  discount?: { amount: number; currency: string };
  tax?: { basisPoints?: number; amount: number; currency: string };
  total: { amount: number; currency: string };
  paymentTerms: PaymentTerms;
  depositBasisPoints?: number;
  estimatedStart?: Date;
  estimatedDurationDays?: number;
  expiresAt: Date;
  status: QuoteStatus;
  pdfStorageKey?: string;
  issuedByUserId?: Types.ObjectId;
  issuedAt?: Date;
  firstViewedAt?: Date;
  acceptedByUserId?: Types.ObjectId;
  acceptedAt?: Date;
  acceptedQuoteVersion?: number;
  rejectionReason?: string;

  /* ── vendor ticket 14: custom work on a vendor's product ── */

  /** Whose software this quote is about. Absent ⇒ the platform's own work, as before. */
  vendorId?: Types.ObjectId;
  /** The brief the vendor priced, for provenance. */
  vendorBriefId?: Types.ObjectId;
  /**
   * **The vendor's own figure**, and the basis for what they are owed — not the quote total.
   *
   * Two numbers, deliberately. The vendor priced the work and that price is what their earning is
   * computed from; the customer's total defaults to it but staff may quote higher, and the difference
   * is platform margin on top of commission. Reading the vendor's share off the *total* would mean a
   * staff member raising the price silently raised what we owe, which is not what "the vendor prices
   * it" promised.
   */
  vendorAmount?: { amount: number; currency: string };
  /**
   * The commission rate, **snapshotted when the quote was issued**.
   *
   * The same rule as `OrderLine.commissionBasisPoints` — "resolved at checkout and never re-read".
   * A rate change must not retroactively alter what a vendor is owed on work already quoted, and
   * reading `resolveCommissionForVendor()` at payment time would do exactly that.
   */
  vendorCommissionBasisPoints?: number;
}

const quoteSchema = new Schema<QuoteDoc>(
  {
    /*
     * `referenceField` minus its `unique`, because a quote's reference is
     * **not** unique — a revision keeps it and bumps `version`. That is
     * deliberate: a customer talking about "QUO-2026-0004" means the quote, not
     * one revision of it, and renumbering on every revision would make their
     * emails stop matching our records.
     *
     * Uniqueness moves to `{reference, version}` below. Found by an integration
     * test: `E11000 ... reference_1 dup key` the first time a v2 was created.
     */
    reference: { ...referenceField, unique: false },
    // A revision creates v2 and supersedes v1 — never edits in place (ticket 22).
    version: { type: Number, default: 1 },
    supersedesQuoteId: { type: Schema.Types.ObjectId, ref: "Quote" },

    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    requestId: {
      type: Schema.Types.ObjectId,
      ref: "CustomerRequest",
      required: true,
      index: true,
    },

    title: { type: String, required: true },
    scope: String,
    deliverables: { type: [String], default: [] },
    // §51 — the field most quoting tools omit and every scope dispute needs.
    exclusions: { type: [String], default: [] },
    notes: String,

    items: { type: [quoteItemSchema], default: [] },
    currency: { type: String, required: true, uppercase: true },
    subtotal: { type: MoneySchema, required: true },
    discount: { amount: Number, currency: String },
    tax: { basisPoints: Number, amount: Number, currency: String },
    total: { type: MoneySchema, required: true },

    paymentTerms: { type: String, enum: PAYMENT_TERMS, default: "full_upfront" },
    depositBasisPoints: Number,
    estimatedStart: Date,
    estimatedDurationDays: Number,
    expiresAt: { type: Date, required: true },

    status: { type: String, enum: QUOTE_STATUSES, default: "draft", index: true },
    // The exact document the customer was sent, so "what did I agree to?" has
    // one answer (ticket 22).
    pdfStorageKey: String,

    issuedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    issuedAt: Date,
    firstViewedAt: Date,
    acceptedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    acceptedAt: Date,
    acceptedQuoteVersion: Number,
    rejectionReason: String,

    // Vendor ticket 14. All absent on every quote that existed before it, and on first-party work.
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    vendorBriefId: { type: Schema.Types.ObjectId, ref: "VendorBrief" },
    vendorAmount: { type: MoneySchema },
    vendorCommissionBasisPoints: Number,
  },
  schemaOptions({ collection: "quotes" }),
);

// One row per version of a reference. Replaces the plain `unique` on
// `reference`, which made revisions impossible.
quoteSchema.index({ reference: 1, version: 1 }, { unique: true });
quoteSchema.index({ organizationId: 1, createdAt: -1 });
// §31 "Quotes Awaiting Approval" + the ticket-25 expiry sweep.
quoteSchema.index({ status: 1, expiresAt: 1 });
/**
 * Quote outcomes over time, and the "how long from request to quote" figure.
 *
 * `{ status, expiresAt }` above serves the expiry sweep and cannot serve this: a
 * range on `issuedAt` after an equality on `status` needs `issuedAt` as the
 * second key. Both are narrow and the collection is small next to orders.
 */
quoteSchema.index({ status: 1, issuedAt: -1 });

export const Quote = defineModel<QuoteDoc>("Quote", quoteSchema);

/* ────────────────────────────────────────────── Invoice */

const invoiceItemSchema = new Schema(
  {
    // Carried over from the quote line. Without it here Mongoose strips `kind`
    // on the way in and the stored document quietly stops matching `QuoteItem`,
    // which is the type this field claims to hold.
    kind: { type: String, enum: QUOTE_ITEM_KINDS, required: true },
    description: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: MoneySchema, required: true },
    lineTotal: { type: MoneySchema, required: true },
  },
  { _id: false },
);

export interface InvoiceDoc {
  _id: Types.ObjectId;
  reference: string;
  organizationId: Types.ObjectId;
  sourceType: InvoiceSourceType;
  sourceId: Types.ObjectId;
  /** "deposit" / "balance" when a quote splits into two (ticket 23). */
  portion?: "full" | "deposit" | "balance";
  items: QuoteItem[];
  currency: string;
  subtotal: { amount: number; currency: string };
  tax?: { basisPoints?: number; amount: number; currency: string };
  total: { amount: number; currency: string };
  amountPaid: { amount: number; currency: string };
  status: InvoiceStatus;
  dueAt?: Date;
  issuedAt?: Date;
  paidAt?: Date;
  pdfStorageKey?: string;
  remindersSentAt: Date[];
}

const invoiceSchema = new Schema<InvoiceDoc>(
  {
    reference: referenceField,
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    sourceType: { type: String, enum: INVOICE_SOURCE_TYPES, required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    portion: { type: String, enum: ["full", "deposit", "balance"], default: "full" },

    // Snapshotted from the accepted quote (§61) — an invoice never re-derives
    // from a live quote that may since have been superseded.
    items: { type: [invoiceItemSchema], default: [] },
    currency: { type: String, required: true, uppercase: true },
    subtotal: { type: MoneySchema, required: true },
    tax: { basisPoints: Number, amount: Number, currency: String },
    total: { type: MoneySchema, required: true },
    // Accumulates across partial payments; `paid` only when >= total.
    amountPaid: { type: MoneySchema, required: true },

    status: { type: String, enum: INVOICE_STATUSES, default: "draft", index: true },
    dueAt: Date,
    issuedAt: Date,
    paidAt: Date,
    pdfStorageKey: String,
    // Dunning must stop the moment an invoice is paid (ticket 23).
    remindersSentAt: { type: [Date], default: [] },
  },
  schemaOptions({ collection: "invoices" }),
);

invoiceSchema.index({ organizationId: 1, createdAt: -1 });
invoiceSchema.index({ status: 1, dueAt: 1 });

export const Invoice = defineModel<InvoiceDoc>("Invoice", invoiceSchema);
