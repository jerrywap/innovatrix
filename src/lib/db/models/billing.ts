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

const quoteItemSchema = new Schema(
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
  items: unknown[];
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
}

const quoteSchema = new Schema<QuoteDoc>(
  {
    reference: referenceField,
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
  },
  schemaOptions({ collection: "quotes" }),
);

quoteSchema.index({ organizationId: 1, createdAt: -1 });
// §31 "Quotes Awaiting Approval" + the ticket-25 expiry sweep.
quoteSchema.index({ status: 1, expiresAt: 1 });

export const Quote = defineModel<QuoteDoc>("Quote", quoteSchema);

/* ────────────────────────────────────────────── Invoice */

const invoiceItemSchema = new Schema(
  {
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
  items: unknown[];
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
