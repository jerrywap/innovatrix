import { Schema, type Types } from "mongoose";
import { MoneySchema, ORG_SCOPE_FIELD, referenceField, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  CART_ITEM_KINDS,
  ENTITLEMENT_STATUSES,
  LICENCE_STATUSES,
  LICENCE_TYPES,
  ORDER_STATUSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PAYMENT_SUBJECT_TYPES,
  type EntitlementStatus,
  type LicenceStatus,
  type LicenceType,
  type OrderStatus,
  type PaymentProvider,
  type PaymentStatus,
  type PaymentSubjectType,
} from "../enums";

/**
 * Commerce — §11–13 (buy as-is, cart, checkout), §61 (orders), §62 (payments),
 * §64 (entitlements), §65 (licensing), §66 (downloads).
 *
 * The rule that shapes every schema here is §61: **an order preserves its own
 * pricing forever.** Order lines are snapshots, not references with a price
 * looked up at render time. If a product is re-priced, delisted or deleted, a
 * two-year-old invoice must still reconcile to the penny.
 */

/* ────────────────────────────────────────────── Cart */

const cartItemSchema = new Schema(
  {
    kind: { type: String, enum: CART_ITEM_KINDS, required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    licencePackageKey: String,
    addonKey: String,
    /** Which product line an add-on hangs off, so removing the product removes it. */
    parentLineId: String,
    lineId: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    // Captured at add time and re-validated on every read (ticket 10). A price
    // change is surfaced to the customer, never silently applied.
    unitPrice: { type: MoneySchema, required: true },
    displayName: { type: String, required: true },
    displaySummary: String,
  },
  { _id: false },
);

export interface CartDoc {
  _id: Types.ObjectId;
  ownerKey: string;
  userId?: Types.ObjectId;
  organizationId?: Types.ObjectId;
  currency: string;
  items: unknown[];
  discountCode?: string;
  expiresAt: Date;
}

const cartSchema = new Schema<CartDoc>(
  {
    // Guest cookie id or `user:<id>` — lets a guest cart merge on login.
    ownerKey: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    [ORG_SCOPE_FIELD]: { type: Schema.Types.ObjectId, ref: "Organization" },
    // One currency per cart (ticket 10). Mixing them makes a single total
    // meaningless, so it is a schema-level fact rather than a UI rule.
    currency: { type: String, required: true, uppercase: true, default: "GBP" },
    items: { type: [cartItemSchema], default: [] },
    discountCode: { type: String, uppercase: true, trim: true },
    expiresAt: { type: Date, required: true },
  },
  schemaOptions({ collection: "carts" }),
);

cartSchema.index({ ownerKey: 1 }, { unique: true });
// §12 cart expiry, swept by Mongo rather than a job.
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Cart = defineModel<CartDoc>("Cart", cartSchema);

/* ────────────────────────────────────────────── Order */

/**
 * §61 — the snapshot. Everything the invoice, the entitlement and the support
 * agent need is copied in at purchase time.
 */
const orderItemSchema = new Schema(
  {
    lineId: { type: String, required: true },
    kind: { type: String, enum: CART_ITEM_KINDS, required: true },

    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true },
    productSlug: { type: String, required: true },
    versionId: { type: Schema.Types.ObjectId, ref: "ProductVersion" },
    versionNumber: String,

    licencePackageKey: String,
    licencePackageName: String,
    licenceType: { type: String, enum: LICENCE_TYPES },
    activationLimit: Number,
    supportMonths: Number,
    updateMonths: Number,

    addonKey: String,
    addonName: String,

    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: MoneySchema, required: true },
    lineTotal: { type: MoneySchema, required: true },
  },
  { _id: false },
);

export interface OrderDoc {
  _id: Types.ObjectId;
  reference: string;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  currency: string;
  items: unknown[];
  subtotal: { amount: number; currency: string };
  discount?: { code?: string; amount: number; currency: string };
  tax?: { ruleId?: string; basisPoints?: number; amount: number; currency: string };
  total: { amount: number; currency: string };
  status: OrderStatus;
  billingSnapshot: Record<string, unknown>;
  paymentId?: Types.ObjectId;
  paidAt?: Date;
  fulfilledAt?: Date;
}

const orderSchema = new Schema<OrderDoc>(
  {
    reference: referenceField,
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    currency: { type: String, required: true, uppercase: true },
    items: { type: [orderItemSchema], required: true },

    subtotal: { type: MoneySchema, required: true },
    discount: {
      code: String,
      amount: Number,
      currency: String,
    },
    // The tax rule id is stored so a rate change never rewrites history.
    tax: {
      ruleId: String,
      basisPoints: Number,
      amount: Number,
      currency: String,
    },
    total: { type: MoneySchema, required: true },

    status: {
      type: String,
      enum: ORDER_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    billingSnapshot: { type: Schema.Types.Mixed, default: {} },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    paidAt: Date,
    fulfilledAt: Date,
  },
  schemaOptions({ collection: "orders" }),
);

orderSchema.index({ organizationId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

export const Order = defineModel<OrderDoc>("Order", orderSchema);

/* ────────────────────────────────────────────── Payment */

export interface PaymentDoc {
  _id: Types.ObjectId;
  reference: string;
  organizationId: Types.ObjectId;
  provider: PaymentProvider;
  providerRef: string;
  subjectType: PaymentSubjectType;
  subjectId: Types.ObjectId;
  amount: { amount: number; currency: string };
  status: PaymentStatus;
  verifiedAt?: Date;
  paidAt?: Date;
  failureReason?: string;
  reviewReason?: string;
  recordedByUserId?: Types.ObjectId;
}

const paymentSchema = new Schema<PaymentDoc>(
  {
    reference: referenceField,
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    /** The provider's own id. Half of the idempotency key. */
    providerRef: { type: String, required: true },
    subjectType: { type: String, enum: PAYMENT_SUBJECT_TYPES, required: true },
    subjectId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: MoneySchema, required: true },
    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      required: true,
      default: "pending",
      index: true,
    },
    verifiedAt: Date,
    paidAt: Date,
    failureReason: String,
    /** Set when a verified amount doesn't match the subject total (ticket 13). */
    reviewReason: String,
    /** Present only for `provider: "manual"` — staff-recorded bank transfers. */
    recordedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  schemaOptions({ collection: "payments" }),
);

/**
 * THE webhook idempotency key (§87). Dropping this index reintroduces double
 * fulfilment — a customer charged once and licensed twice. Do not "optimise"
 * it away.
 */
paymentSchema.index({ provider: 1, providerRef: 1 }, { unique: true });
paymentSchema.index({ status: 1, createdAt: 1 });

export const Payment = defineModel<PaymentDoc>("Payment", paymentSchema);

/* ────────────────────────────────────────────── WebhookEvent */

export interface WebhookEventDoc {
  _id: Types.ObjectId;
  provider: PaymentProvider;
  eventId: string;
  eventType: string;
  status: "received" | "processed" | "failed";
  payload: unknown;
  error?: string;
  attempts: number;
  processedAt?: Date;
}

const webhookEventSchema = new Schema<WebhookEventDoc>(
  {
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    status: { type: String, enum: ["received", "processed", "failed"], default: "received" },
    // Raw body retained verbatim: a dispute or a provider-side bug is only
    // arguable with the original payload.
    payload: { type: Schema.Types.Mixed, required: true },
    error: String,
    attempts: { type: Number, default: 0 },
    processedAt: Date,
  },
  schemaOptions({ collection: "webhookEvents" }),
);

// Duplicate delivery is normal, not an error (§87) — this makes it a no-op.
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ status: 1, createdAt: 1 });

export const WebhookEvent = defineModel<WebhookEventDoc>("WebhookEvent", webhookEventSchema);

/* ────────────────────────────────────────────── Entitlement */

export interface EntitlementDoc {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  productId: Types.ObjectId;
  orderId: Types.ObjectId;
  orderLineId: string;
  licenceId?: Types.ObjectId;
  purchasedVersionId?: Types.ObjectId;
  updatesUntil?: Date;
  supportUntil?: Date;
  status: EntitlementStatus;
}

const entitlementSchema = new Schema<EntitlementDoc>(
  {
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderLineId: { type: String, required: true },
    licenceId: { type: Schema.Types.ObjectId, ref: "Licence" },
    // The version bought stays downloadable forever, even past updatesUntil
    // (ticket 14).
    purchasedVersionId: { type: Schema.Types.ObjectId, ref: "ProductVersion" },
    updatesUntil: Date,
    supportUntil: Date,
    status: { type: String, enum: ENTITLEMENT_STATUSES, default: "active", index: true },
  },
  schemaOptions({ collection: "entitlements" }),
);

/**
 * Makes fulfilment idempotent. Webhook and reconciliation racing (ticket 13)
 * both try to create this; the second one collides instead of issuing a
 * duplicate licence.
 */
entitlementSchema.index({ orderId: 1, orderLineId: 1 }, { unique: true });
entitlementSchema.index({ organizationId: 1, productId: 1 });

export const Entitlement = defineModel<EntitlementDoc>("Entitlement", entitlementSchema);

/* ────────────────────────────────────────────── Licence */

const activationSchema = new Schema(
  {
    instanceId: { type: String, required: true },
    domain: String,
    activatedAt: { type: Date, default: () => new Date() },
    releasedAt: Date,
  },
  { _id: false },
);

export interface LicenceDoc {
  _id: Types.ObjectId;
  key: string;
  organizationId: Types.ObjectId;
  productId: Types.ObjectId;
  entitlementId: Types.ObjectId;
  type: LicenceType;
  activationLimit: number;
  activations: unknown[];
  status: LicenceStatus;
  expiresAt?: Date;
  supportExpiresAt?: Date;
}

const licenceSchema = new Schema<LicenceDoc>(
  {
    // Unguessable: CSPRNG + check character, no sequence, no order id (ticket 14).
    key: { type: String, required: true, uppercase: true, trim: true },
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    entitlementId: { type: Schema.Types.ObjectId, ref: "Entitlement", required: true },
    type: { type: String, enum: LICENCE_TYPES, required: true },
    activationLimit: { type: Number, default: 1 },
    activations: { type: [activationSchema], default: [] },
    status: { type: String, enum: LICENCE_STATUSES, default: "active", index: true },
    expiresAt: Date,
    supportExpiresAt: Date,
  },
  schemaOptions({ collection: "licences" }),
);

licenceSchema.index({ key: 1 }, { unique: true });
licenceSchema.index({ entitlementId: 1 }, { unique: true });

export const Licence = defineModel<LicenceDoc>("Licence", licenceSchema);

/* ────────────────────────────────────────────── Download */

export interface DownloadDoc {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  entitlementId: Types.ObjectId;
  productFileId: Types.ObjectId;
  userId: Types.ObjectId;
  ip?: string;
  userAgent?: string;
}

const downloadSchema = new Schema<DownloadDoc>(
  {
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    entitlementId: {
      type: Schema.Types.ObjectId,
      ref: "Entitlement",
      required: true,
      index: true,
    },
    productFileId: { type: Schema.Types.ObjectId, ref: "ProductFile", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    ip: String,
    userAgent: String,
  },
  // Append-only audit (§66). No soft delete, no updates.
  schemaOptions({ collection: "downloads" }),
);

downloadSchema.index({ entitlementId: 1, createdAt: -1 });

export const Download = defineModel<DownloadDoc>("Download", downloadSchema);

/* ────────────────────────────────────────────── PaymentSettings */

export interface PaymentSettingsDoc {
  _id: Types.ObjectId;
  singleton: "global";
  providers: {
    key: PaymentProvider;
    enabled: boolean;
    mode: "test" | "live";
    /** Env var NAME only. The value never touches the database (§88). */
    secretEnvVar?: string;
    supportedCurrencies: string[];
  }[];
  currencyRouting: {
    currency: string;
    primary: PaymentProvider;
    fallbacks: PaymentProvider[];
  }[];
  updatedByUserId?: Types.ObjectId;
}

const paymentSettingsSchema = new Schema<PaymentSettingsDoc>(
  {
    singleton: { type: String, default: "global", enum: ["global"] },
    providers: {
      type: [
        new Schema(
          {
            key: { type: String, enum: PAYMENT_PROVIDERS, required: true },
            enabled: { type: Boolean, default: false },
            mode: { type: String, enum: ["test", "live"], default: "test" },
            secretEnvVar: String,
            supportedCurrencies: { type: [String], default: [] },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    currencyRouting: {
      type: [
        new Schema(
          {
            currency: { type: String, required: true, uppercase: true },
            primary: { type: String, enum: PAYMENT_PROVIDERS, required: true },
            fallbacks: { type: [String], enum: PAYMENT_PROVIDERS, default: [] },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    updatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  schemaOptions({ collection: "paymentSettings" }),
);

paymentSettingsSchema.index({ singleton: 1 }, { unique: true });

export const PaymentSettings = defineModel<PaymentSettingsDoc>(
  "PaymentSettings",
  paymentSettingsSchema,
);
