import { Schema, type Types } from "mongoose";
import { MoneySchema, referenceField, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  LEDGER_ENTRY_KINDS,
  LEDGER_ENTRY_STATUSES,
  PAYOUT_STATUSES,
  type LedgerEntryKind,
  type LedgerEntryStatus,
  type PayoutStatus,
} from "../enums";

/**
 * What a vendor is owed, and what has been paid — vendor tickets 08 and 09.
 *
 * Money was strictly **inbound** before this: every `PaymentProvider` collects, and there
 * was no ledger, balance, payee or payout anywhere. So this is the first place the
 * platform records a debt to somebody else, and the first place money leaves.
 *
 * ## Append-only, and a balance that is never stored
 *
 * A balance is **derived by summing entries**. A stored balance is a number that can
 * disagree with its own history, and the first time it does the disagreement is
 * unresolvable — you have two numbers and no way to know which is the lie. The audit log
 * already takes this position and money deserves at least as much.
 *
 * That is why `kind` and a **signed** `amount` rather than separate collections: a
 * clawback is a negative row beside the earning it reverses, not an edit to it, so "how
 * did we get to this number" is answerable by reading downward.
 */

export interface LedgerEntryDoc {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  kind: LedgerEntryKind;
  /**
   * Signed minor units. Earnings positive, refunds and payouts negative.
   *
   * `MoneySchema` validates the integer, so a float cannot get in — §84.
   */
  amount: { amount: number; currency: string };
  status: LedgerEntryStatus;
  /**
   * When this becomes payable.
   *
   * Set on an earning at fulfilment, `clearanceDate()`. The sweep's filter is
   * `{ status: "pending", clearsAt: { $lte: now } }`, which is idempotent by
   * construction — running it twice in a day changes nothing the second time.
   */
  clearsAt?: Date;
  /** The order line that produced it, so a figure is traceable to a purchase. */
  orderId?: Types.ObjectId;
  orderLineId?: string;
  /** The payout that settled it — vendor ticket 09. */
  payoutId?: Types.ObjectId;
  /** Required on an adjustment. A ledger without adjustments grows a spreadsheet beside it. */
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ledgerEntrySchema = new Schema<LedgerEntryDoc>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    kind: { type: String, enum: LEDGER_ENTRY_KINDS, required: true },
    amount: { type: MoneySchema, required: true },
    status: { type: String, enum: LEDGER_ENTRY_STATUSES, required: true, default: "pending" },
    clearsAt: Date,
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    orderLineId: String,
    payoutId: { type: Schema.Types.ObjectId, ref: "Payout" },
    note: { type: String, trim: true },
  },
  schemaOptions({ collection: "ledgerEntries" }),
);

/**
 * One entry per line per kind — the guard that stops a retried webhook paying twice.
 *
 * Exactly the shape `{ orderId, orderLineId }` already has on `entitlements`, doing the
 * same job one field wider: `kind` is in the key because a refund is a *second* row about
 * the same line and must be allowed, while a second **earning** must not.
 *
 * Partial, because adjustments and payouts have no order line and would all collide on
 * `(null, null)`.
 */
ledgerEntrySchema.index(
  { orderId: 1, orderLineId: 1, kind: 1 },
  { unique: true, partialFilterExpression: { orderId: { $exists: true } } },
);

/** The sweep's filter, and the balance query. */
ledgerEntrySchema.index({ status: 1, clearsAt: 1 });
ledgerEntrySchema.index({ vendorId: 1, status: 1, createdAt: -1 });
ledgerEntrySchema.index({ payoutId: 1 });

/**
 * §90's discipline, for money.
 *
 * The audit log refuses amendment on the model because a repository guard alone is not
 * enough — `LedgerEntry.updateOne(...)` never touches a repository. The same argument
 * applies here and the stakes are the same: an entry that can be edited is a balance
 * whose history is fiction.
 *
 * `status` has to change, though — `pending → cleared → paid` is the whole point — so this
 * is narrower than the audit log's blanket refusal. Amount, kind, vendor and the order
 * link are immutable; a correction is an `adjustment` row.
 */
const IMMUTABLE = ["amount", "kind", "vendorId", "orderId", "orderLineId"] as const;

const APPEND_ONLY =
  "Ledger entries are append-only (vendor ticket 08). Reverse one with a negative entry " +
  "rather than deleting it — a balance is the sum of its history.";

function refuseDeletion(): never {
  throw new Error(APPEND_ONLY);
}

/*
 * Written out rather than looped, following `auditLogSchema`: Mongoose types each hook
 * name as its own overload, so a loop over a string union needs an `any` cast — and a
 * cast in the middle of a money control is the wrong economy.
 *
 * Narrower than the audit log's blanket refusal: update hooks are **not** refused,
 * because `pending → cleared → paid` is the whole point and the clearance sweep is an
 * `updateMany`. What is protected is the *content* — see the `save` hook below and, for
 * the update paths, the fact that every writer in `ledger-service.ts` sets only `status`
 * and `payoutId`.
 */
ledgerEntrySchema.pre("deleteOne", refuseDeletion);
ledgerEntrySchema.pre("deleteMany", refuseDeletion);
ledgerEntrySchema.pre("findOneAndDelete", refuseDeletion);

ledgerEntrySchema.pre("save", function refuseAmendment() {
  if (this.isNew) return;
  const changed = IMMUTABLE.filter((path) => this.isModified(path));
  if (changed.length > 0) {
    throw new Error(
      `A ledger entry's ${changed.join(", ")} cannot be changed (vendor ticket 08). ` +
        `Write an adjustment instead.`,
    );
  }
});

export const LedgerEntry = defineModel<LedgerEntryDoc>("LedgerEntry", ledgerEntrySchema);

/* ────────────────────────────────────────────── Payout */

/**
 * A claim on cleared entries — vendor ticket 09.
 *
 * `entryIds` is the field that matters: a payout recording only a total cannot be
 * reconciled against the ledger, and reconciling is the entire reason the ledger is
 * append-only.
 */
export interface PayoutDoc {
  _id: Types.ObjectId;
  /** `POU-YYYY-NNNN`. Its own prefix — inbound payments already own `PAY`. */
  reference: string;
  vendorId: Types.ObjectId;
  amount: { amount: number; currency: string };
  status: PayoutStatus;
  /** A `PayoutProvider` key. `manual` is the only driver at launch. */
  method: string;
  periodStart: Date;
  periodEnd: Date;
  /** Exactly which entries this settles. Their sum must equal `amount`. */
  entryIds: Types.ObjectId[];
  /** The bank reference, once sent. */
  externalReference?: string;
  /** Remittance advice, read through an authorised route like payment evidence. */
  evidenceKey?: string;
  failureReason?: string;
  approvedByUserId?: Types.ObjectId;
  sentByUserId?: Types.ObjectId;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const payoutSchema = new Schema<PayoutDoc>(
  {
    reference: referenceField,
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    amount: { type: MoneySchema, required: true },
    status: {
      type: String,
      enum: PAYOUT_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    method: { type: String, required: true, default: "manual" },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    entryIds: { type: [Schema.Types.ObjectId], default: [] },
    externalReference: { type: String, trim: true },
    evidenceKey: { type: String, trim: true },
    failureReason: { type: String, trim: true },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    sentByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    paidAt: Date,
  },
  schemaOptions({ collection: "payouts" }),
);

payoutSchema.index({ vendorId: 1, createdAt: -1 });
payoutSchema.index({ status: 1, createdAt: 1 });

/**
 * One payout per vendor per period — the batch job's second guard.
 *
 * `enqueue`'s idempotency key stops a duplicated *job*; this stops a duplicated *draft*,
 * which is the guard that still holds when somebody clicks "run now" on `/admin/jobs`.
 *
 * ## Unconditional, because the conditional version is not expressible
 *
 * The intent was "one *open* payout per period" —
 * `partialFilterExpression: { status: { $in: ["draft", "approved", "sending"] } }` — and
 * MongoDB refuses it: a partial index supports equality, `$exists`, `$type`, the range
 * operators and `$and`, and **not `$in`**. It fails at `syncIndexes` time with
 * "unsupported expression in partial index", which is at least loud.
 *
 * So the index is unconditional, and the cost is named rather than discovered: a
 * **cancelled** payout still occupies its period, so a decision to skip a month and then
 * change your mind needs the cancelled row cleared rather than a second one created. A
 * *failed* payout is unaffected — vendor ticket 09 returns it to `approved` and the next
 * batch reuses that row rather than making another, which is the behaviour this index
 * wants anyway.
 *
 * The alternative was a denormalised `open: boolean` to make the filter expressible, and a
 * flag that can disagree with the status it mirrors is a worse trade in a money
 * collection than a rare manual step.
 */
payoutSchema.index({ vendorId: 1, periodStart: 1, periodEnd: 1 }, { unique: true });

export const Payout = defineModel<PayoutDoc>("Payout", payoutSchema);
