import { Schema, type SchemaDefinition, type SchemaOptions, Types } from "mongoose";
import { CURRENCIES } from "@/lib/money";

/**
 * Schema conventions shared by every collection.
 *
 * MongoDB gives us no foreign keys and no CHECK constraints, so anything that
 * would be a database constraint in Postgres has to be produced here or in the
 * service layer. This module is the "here" half.
 */

export const BASE_SCHEMA_OPTIONS: SchemaOptions = {
  timestamps: true,
  versionKey: false,
  minimize: false,
  toJSON: {
    virtuals: true,
    transform(_doc, ret: Record<string, unknown>) {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  },
  toObject: { virtuals: true },
};

/**
 * Money — spec §84.
 *
 * `amount` is a count of minor units and must be a whole number. A float here
 * is silent corruption that surfaces months later as an invoice that doesn't
 * reconcile, so the validator is not optional and not advisory.
 */
export const MoneySchema = new Schema(
  {
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: (props: { value: unknown }) =>
          `Money must be an integer in minor units; received ${props.value}. ` +
          `Use fromDecimal() rather than storing a decimal.`,
      },
    },
    currency: {
      type: String,
      required: true,
      enum: Object.keys(CURRENCIES),
      uppercase: true,
      trim: true,
    },
  },
  { _id: false },
);

/** Attached to every document that belongs to a customer organization. */
export const ORG_SCOPE_FIELD = "organizationId" as const;

export function orgScoped<T extends SchemaDefinition>(definition: T): T & SchemaDefinition {
  return {
    ...definition,
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
  };
}

/** Soft-delete marker. Repositories exclude these by default. */
export function softDeletable<T extends SchemaDefinition>(definition: T): T & SchemaDefinition {
  return {
    ...definition,
    deletedAt: { type: Date, default: null, index: true },
  };
}

/**
 * A human-facing business reference (§26) — unique and immutable.
 *
 * `unique: true` already builds the index, so collections using this must NOT
 * also declare `schema.index({ reference: 1 }, { unique: true })`; Mongoose
 * warns about the duplicate and Mongo builds two identical indexes.
 */
export const referenceField = {
  type: String,
  required: true,
  unique: true,
  immutable: true,
  uppercase: true,
  trim: true,
} as const;

/**
 * Merge the shared options with per-collection overrides.
 *
 * Deliberately *not* a `createSchema<T>()` wrapper. Mongoose 9's `Schema` carries
 * ten-plus type parameters that infer from the definition object; a generic
 * wrapper returning `Schema<T>` for an unresolved `T` cannot unify with them and
 * only typechecks behind a cast. Calling `new Schema<Doc>(definition,
 * schemaOptions())` directly keeps full inference and needs no cast:
 *
 *   const productSchema = new Schema<Product>(
 *     softDeletable(orgScoped({ name: { type: String, required: true } })),
 *     schemaOptions({ collection: "products" }),
 *   );
 */
export function schemaOptions(overrides: SchemaOptions = {}): SchemaOptions {
  return { ...BASE_SCHEMA_OPTIONS, ...overrides };
}

/* ────────────────────────────────────────────── ids */

export function toObjectId(value: string | Types.ObjectId): Types.ObjectId {
  if (value instanceof Types.ObjectId) return value;
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`"${value}" is not a valid ObjectId.`);
  }
  return new Types.ObjectId(value);
}

export function isObjectIdLike(value: unknown): value is string | Types.ObjectId {
  return (
    value instanceof Types.ObjectId ||
    (typeof value === "string" && Types.ObjectId.isValid(value))
  );
}

/**
 * Is this a unique-index violation?
 *
 * Three copies of this predicate already existed — `webhook-event.repository.ts`,
 * `product-service.ts`, `version-service.ts` — which is three chances to write `1100` and
 * silently stop catching the case. This is the shared one for new callers; the existing
 * three are left alone rather than swept into an unrelated change.
 *
 * MongoDB reports every duplicate key as 11000 regardless of which index it was, so a
 * caller that cares *which* constraint fired has to look at the message. Most do not: they
 * are handling a race whose remedy is "read what the winner wrote".
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
