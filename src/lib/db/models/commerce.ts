import { Schema, type Types } from "mongoose";
import { MoneySchema, ORG_SCOPE_FIELD, referenceField, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  CART_ITEM_KINDS,
  DISCOUNT_KINDS,
  ENTITLEMENT_STATUSES,
  LICENCE_STATUSES,
  LICENCE_TYPES,
  ORDER_STATUSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PAYMENT_SUBJECT_TYPES,
  TAX_RULE_KINDS,
  type CartItemKind,
  type DiscountKind,
  type EntitlementStatus,
  type LicenceStatus,
  type LicenceType,
  type OrderStatus,
  type PaymentProvider,
  type PaymentStatus,
  type PaymentSubjectType,
  type TaxRuleKind,
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

/* ────────────────────────────────────────────── embedded shapes */

/**
 * The line shapes, exported rather than left as `unknown[]`.
 *
 * These were `unknown[]` on `CartDoc` and `OrderDoc`, which is the same hole
 * ticket 06 closed in `catalog.ts` — and it is worse here. For a cart it means
 * TypeScript cannot stop a **client-supplied `unitPrice`** being written
 * straight through. For an order it means the §61 snapshot, the thing an
 * invoice reconciles against two years later, has no compile-time shape at all.
 *
 * `MoneyDocument` rather than `Money`: the stored `currency` is a plain string,
 * because the *document* is not the money type. Services convert at the edge.
 */

export interface MoneyDocument {
  amount: number;
  currency: string;
}

export interface CartItem {
  lineId: string;
  kind: CartItemKind;
  productId: Types.ObjectId;
  licencePackageKey?: string;
  addonKey?: string;
  /** Which product line an add-on hangs off. Absent on a product line. */
  parentLineId?: string;
  quantity: number;
  /**
   * What the price **was** when this was added.
   *
   * Deliberately not what the customer is charged. `recalculate()` compares it
   * against the live product on every read and surfaces a change as a notice;
   * nothing downstream reads this as an amount to bill.
   */
  unitPrice: MoneyDocument;
  displayName: string;
  displaySummary?: string;
}

/** §61's snapshot. Everything an invoice or a support agent needs, copied in. */
export interface OrderItem {
  lineId: string;
  kind: CartItemKind;
  productId: Types.ObjectId;
  productName: string;
  productSlug: string;
  versionId?: Types.ObjectId;
  versionNumber?: string;
  licencePackageKey?: string;
  licencePackageName?: string;
  licenceType?: LicenceType;
  activationLimit?: number;
  supportMonths?: number;
  updateMonths?: number;
  addonKey?: string;
  addonName?: string;
  parentLineId?: string;
  quantity: number;
  unitPrice: MoneyDocument;
  lineTotal: MoneyDocument;
  /**
   * Who sells this line — vendor ticket 07. Absent ⇒ first-party.
   *
   * On the *line*, not the order: an order can mix a vendor's product with one of ours,
   * and with an add-on that belongs to neither.
   */
  vendorId?: Types.ObjectId;
  /**
   * The commission rate **resolved at checkout and never re-read**.
   *
   * This is the whole point of the field. A rate change must never rewrite what a vendor
   * earned last month, and resolving at payout time would do exactly that — silently,
   * and in the platform's favour, which is the worst possible direction for a mistake in
   * a revenue share. §61 already freezes a historical price; a rate is the same kind of
   * fact and gets the same treatment.
   *
   * Basis points, so 3000 is 30% and every calculation is integer. A percentage held as
   * `0.3` is the same mistake as a price held as a float.
   */
  commissionBasisPoints?: number;
}

/**
 * Billing details as they stood at purchase.
 *
 * Stored as `Mixed`, but typed here because this is what an invoice renders and
 * what a tax authority reads years later. The organisation's current address is
 * not an answer to "where was this sold" — it may have moved twice since.
 */
export interface BillingSnapshot {
  organizationName?: string;
  contactName?: string;
  email?: string;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postcode?: string;
  country?: string;
  taxId?: string;
}

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
  items: CartItem[];
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
    /** Mirrors the cart, so an order line knows which product it was bought with. */
    parentLineId: String,

    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: MoneySchema, required: true },
    lineTotal: { type: MoneySchema, required: true },
    // Vendor ticket 07. Absent on a first-party line, and absence is the only signal —
    // no sentinel vendor, no `commissionBasisPoints: 0` meaning "ours".
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    commissionBasisPoints: {
      type: Number,
      min: 0,
      max: 10_000,
      validate: (v: unknown) => v == null || Number.isInteger(v),
    },
  },
  { _id: false },
);

export interface OrderDoc {
  _id: Types.ObjectId;
  reference: string;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  currency: string;
  items: OrderItem[];
  subtotal: MoneyDocument;
  /**
   * ⚠️ Mongoose materialises an unset **nested path** as `{}`, not `undefined`.
   * So `if (order.discount)` is true for an order with no discount, and the
   * only safe check is on a field: `if (order.discount?.amount)`. The `?` here
   * describes intent; it does not describe what comes back from the driver.
   */
  discount?: { code?: string; amount: number; currency: string };
  /**
   * The rule **id and rate**, not a reference to a live rule. A rate change
   * must never rewrite an order that was already placed (§61) — so the number
   * that was charged is stored, and `ruleId` says which rule produced it.
   */
  tax?: { ruleId?: string; basisPoints?: number; amount: number; currency: string };
  total: MoneyDocument;
  status: OrderStatus;
  billingSnapshot: BillingSnapshot;
  /**
   * Derived from the cart id and a hash of its contents. Two rapid submissions
   * of one cart find the same order rather than creating two (ticket 11).
   */
  idempotencyKey?: string;
  /**
   * How the customer said they would pay.
   *
   * An explicit field rather than "has no payment yet", because those are
   * different states that need different words. An **online** order with no
   * payment abandoned at the provider and should be nudged back to paying; an
   * **offline** order with no payment is behaving correctly and is waiting on
   * a bank transfer somebody has to record. Telling a customer in the second
   * state that their payment failed would be wrong, and inferring from
   * `paymentId == null` is exactly how that happens.
   */
  paymentMethod: "online" | "offline";
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
    idempotencyKey: String,
    // `online` by default, so every order written before this field existed
    // reads as what it was.
    paymentMethod: { type: String, enum: ["online", "offline"], default: "online" },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    paidAt: Date,
    fulfilledAt: Date,
  },
  schemaOptions({ collection: "orders" }),
);

orderSchema.index({ organizationId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
/**
 * Sparse and unique: only orders created through checkout carry a key, and two
 * submissions of the same cart must collide here rather than both inserting.
 */
orderSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

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
  /**
   * Proof of an offline payment — a bank receipt, a remittance advice.
   *
   * **The key only.** This is the most sensitive object the platform stores:
   * it carries account numbers and somebody's banking, and the dev bucket
   * serves any known key over plain HTTPS with no signature. So there is no
   * `url` field here and nothing may build one — `publicObjectUrl()` must
   * never be called on this key. It is read through
   * `/api/payment-evidence/[paymentId]`, which checks a permission, writes an
   * audit row, and redirects to a five-minute presigned GET.
   */
  evidence?: {
    storageKey: string;
    filename: string;
    contentType?: string;
    sizeBytes?: number;
    uploadedAt: Date;
  };
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
    evidence: {
      storageKey: String,
      filename: String,
      contentType: String,
      sizeBytes: Number,
      uploadedAt: Date,
    },
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
  /**
   * `processing` is the **claim**, and it is what makes concurrent delivery
   * safe. A guarded `findOneAndUpdate({ status: "received" } → "processing")`
   * lets exactly one worker take an event; the webhook and the reconciliation
   * sweep can then race freely and only one fulfils.
   *
   * It also distinguishes "never started" from "started and the app died",
   * which the sweep needs — both are stuck, but only the second has already
   * consumed an attempt.
   */
  status: "received" | "processing" | "processed" | "failed";
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
    status: {
      type: String,
      enum: ["received", "processing", "processed", "failed"],
      default: "received",
    },
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

/**
 * One installation of a licence — §65.
 *
 * `releasedAt` rather than deleting the row: "this licence has been installed
 * four times and two are still live" is a support question, and a released
 * activation that leaves no trace makes it unanswerable.
 */
export interface LicenceActivation {
  instanceId: string;
  domain?: string;
  activatedAt: Date;
  releasedAt?: Date;
}

export interface LicenceDoc {
  _id: Types.ObjectId;
  key: string;
  organizationId: Types.ObjectId;
  productId: Types.ObjectId;
  entitlementId: Types.ObjectId;
  type: LicenceType;
  activationLimit: number;
  activations: LicenceActivation[];
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

/**
 * The platform's default commission — vendor ticket 07.
 *
 * On `PaymentSettings` rather than a collection of its own: it is one number, it is
 * platform-wide, and it belongs beside the tax and payment configuration a person is
 * already looking at when they think about what the platform takes.
 *
 * A vendor override lives on the `Vendor`. Two levels, not three — vendor ticket 07
 * dropped the per-product level as the one with the least demand and the most
 * explaining, and `resolveCommission()` is written so a third is additive.
 */
export const DEFAULT_COMMISSION_BASIS_POINTS = 3000;

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
  /**
   * What a customer paying by transfer needs to know — account name, number,
   * sort code, the reference to quote.
   *
   * A settings row and not a secret: bank details are printed on every invoice
   * in the world, and the customer cannot pay without them. Distinct from the
   * provider keys above, which are env-var *names* precisely because they are.
   */
  offlineInstructions?: string;
  /** Off ⇒ the option is not offered at checkout at all. */
  offlineEnabled: boolean;
  /** Vendor ticket 07. Absent ⇒ `DEFAULT_COMMISSION_BASIS_POINTS`. */
  commissionBasisPoints?: number;
  /**
   * The least a vendor's cleared balance may be before a payout is drafted — vendor
   * ticket 09, decision **V3**.
   *
   * **Per currency, and never converted.** A single number cannot serve GBP and NGN, and
   * picking a rate to make it would be an FX decision nobody took. A currency with no
   * threshold configured falls back to `DEFAULT_PAYOUT_THRESHOLD_MINOR`, which is
   * deliberately low: a threshold that is too small only means more payouts, while one
   * that is too large silently withholds somebody's money.
   */
  payoutThresholds?: { currency: string; amount: number }[];
  /**
   * How often a batch is drafted, in days. Absent ⇒ `DEFAULT_PAYOUT_CADENCE_DAYS`.
   *
   * A cadence rather than a day-of-month: "the 1st" needs a calendar and a timezone
   * argument, and a rolling period needs neither.
   */
  payoutCadenceDays?: number;
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
    offlineInstructions: String,
    // Default on: the machinery exists, and a platform that cannot take a bank
    // transfer is the state this ticket set out to fix.
    offlineEnabled: { type: Boolean, default: true },
    // Vendor ticket 07. Same validator set as `TaxRuleDoc.basisPoints` — an integer,
    // 0..10000, because a rate held as a float is the mistake §84 settled for money.
    commissionBasisPoints: {
      type: Number,
      min: 0,
      max: 10_000,
      validate: (v: unknown) => v == null || Number.isInteger(v),
    },
    // Vendor ticket 09. Minor units, integer, per currency — the same discipline as every
    // other amount in the system, on a field that decides whether money moves.
    payoutThresholds: {
      type: [
        new Schema(
          {
            currency: { type: String, required: true, uppercase: true },
            amount: {
              type: Number,
              required: true,
              min: 0,
              validate: (v: unknown) => Number.isInteger(v),
            },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    payoutCadenceDays: {
      type: Number,
      min: 1,
      max: 365,
      validate: (v: unknown) => v == null || Number.isInteger(v),
    },
    updatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  schemaOptions({ collection: "paymentSettings" }),
);

paymentSettingsSchema.index({ singleton: 1 }, { unique: true });

/**
 * The fallback threshold, in minor units — vendor ticket 09.
 *
 * £50 in a two-decimal currency. Low on purpose: too low means more payouts than necessary,
 * too high means quietly sitting on somebody's earnings, and only one of those is a
 * behaviour a vendor would call theft.
 */
export const DEFAULT_PAYOUT_THRESHOLD_MINOR = 5_000;

/** Monthly, in days. Configurable per decision **V3**. */
export const DEFAULT_PAYOUT_CADENCE_DAYS = 30;

export const PaymentSettings = defineModel<PaymentSettingsDoc>(
  "PaymentSettings",
  paymentSettingsSchema,
);

/* ────────────────────────────────────────────── DiscountCode */

/**
 * A discount code — ticket 10.
 *
 * ## `usedCount` is a counter, not a derived number
 *
 * Counting orders that carry the code would be the "clean" answer and it is
 * wrong under concurrency: two customers redeeming the hundredth use of a
 * hundred-use code both count 99 and both succeed. The counter is incremented
 * with `$inc` **inside the checkout transaction**, guarded by a filter on the
 * limit, so the database decides who gets the last one.
 *
 * ## Deactivated, never deleted
 *
 * A code on a two-year-old order must still resolve when support looks at it.
 * `isActive: false` stops new redemptions; nothing removes the row.
 */
export interface DiscountCodeDoc {
  _id: Types.ObjectId;
  code: string;
  description?: string;
  kind: DiscountKind;
  /** Minor units for `fixed`, basis points for `percentage`. */
  value: number;
  /** Required for `fixed` — a fixed amount has no meaning without one. */
  currency?: string;
  minSpend?: MoneyDocument;
  /** Empty means "any product". Both lists are OR'd, then AND'd with min spend. */
  productIds: Types.ObjectId[];
  categorySlugs: string[];
  usageLimit?: number;
  usedCount: number;
  perCustomerLimit?: number;
  startsAt?: Date;
  expiresAt?: Date;
  isActive: boolean;
  createdByUserId?: Types.ObjectId;
}

const discountCodeSchema = new Schema<DiscountCodeDoc>(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    description: String,
    kind: { type: String, enum: DISCOUNT_KINDS, required: true },
    value: { type: Number, required: true, min: 0, validate: Number.isInteger },
    currency: { type: String, uppercase: true },
    minSpend: { type: MoneySchema, default: undefined },
    productIds: { type: [Schema.Types.ObjectId], ref: "Product", default: [] },
    categorySlugs: { type: [String], default: [] },
    usageLimit: Number,
    usedCount: { type: Number, default: 0 },
    perCustomerLimit: Number,
    startsAt: Date,
    expiresAt: Date,
    isActive: { type: Boolean, default: true, index: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  schemaOptions({ collection: "discountCodes" }),
);

// The lookup is always by code, and two rows for one code is a pricing bug.
discountCodeSchema.index({ code: 1 }, { unique: true });

export const DiscountCode = defineModel<DiscountCodeDoc>("DiscountCode", discountCodeSchema);

/* ────────────────────────────────────────────── TaxRule */

/**
 * A tax rule — ticket 10's "simple rule engine keyed on the organization's
 * billing country and product type".
 *
 * ## Editable, and that is exactly why the order snapshots it
 *
 * A rate is a fact about a moment. When VAT changes, every rule here changes
 * with it — and **not one existing order moves**, because `orders.tax` stores
 * the `ruleId` *and* the `basisPoints` that were applied. Reading the rate back
 * off a live rule at render time is the bug this design exists to prevent, and
 * it is the one an "improvement" would reintroduce.
 *
 * ## `ruleId` is a slug, not an ObjectId
 *
 * It is written into every order and read by humans reconciling them.
 * `uk-digital-vat-20` survives a database restore and says what it means;
 * `6a80c46f…` does neither.
 */
export interface TaxRuleDoc {
  _id: Types.ObjectId;
  ruleId: string;
  label: string;
  /** ISO 3166-1 alpha-2, or `*` for the catch-all. */
  country: string;
  kind: TaxRuleKind;
  basisPoints: number;
  /** Highest wins. A country rule must beat the `*` fallback. */
  priority: number;
  isActive: boolean;
  updatedByUserId?: Types.ObjectId;
}

const taxRuleSchema = new Schema<TaxRuleDoc>(
  {
    ruleId: { type: String, required: true, lowercase: true, trim: true },
    label: { type: String, required: true },
    country: { type: String, required: true, uppercase: true, trim: true },
    kind: { type: String, enum: TAX_RULE_KINDS, required: true, default: "any" },
    basisPoints: {
      type: Number,
      required: true,
      min: 0,
      max: 10_000,
      validate: Number.isInteger,
    },
    priority: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    updatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  schemaOptions({ collection: "taxRules" }),
);

taxRuleSchema.index({ ruleId: 1 }, { unique: true });
// The resolution query: active rules for a country, best match first.
taxRuleSchema.index({ isActive: 1, country: 1, priority: -1 });

export const TaxRule = defineModel<TaxRuleDoc>("TaxRule", taxRuleSchema);
