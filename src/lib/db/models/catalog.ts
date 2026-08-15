import { Schema, type Types } from "mongoose";
import { MoneySchema, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  ADDON_PRICING_TYPES,
  DEMO_EXPOSURES,
  FILE_SCAN_STATUSES,
  LICENCE_TYPES,
  PRODUCT_FILE_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VERSION_STATUSES,
  TAXONOMY_KINDS,
  type DemoExposure,
  type FileScanStatus,
  type LicenceType,
  type ProductFileKind,
  type ProductStatus,
  type ProductVersionStatus,
  type TaxonomyKind,
} from "../enums";

/**
 * Catalog — §7 (taxonomy), §8 (product detail), §42–46 (creation, config,
 * lifecycle), §9 (demos), §49 (add-ons), §50 (customisation config).
 *
 * This is where the document model earns its keep: a product page needs media,
 * features, prices, licence packages, add-ons and demo config together, and
 * they are all owned by the product. In a relational schema that is ten joins;
 * here it is one read.
 *
 * Versions and files are *referenced*, not embedded — they grow without bound
 * and are queried on their own (entitlement checks, download authorisation).
 */

/* ────────────────────────────────────────────── Taxonomy */

export interface TaxonomyDoc {
  _id: Types.ObjectId;
  kind: TaxonomyKind;
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
}

const taxonomySchema = new Schema<TaxonomyDoc>(
  {
    kind: { type: String, enum: TAXONOMY_KINDS, required: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: String,
    icon: String,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  schemaOptions({ collection: "taxonomies" }),
);

// Slugs are unique per kind, not globally — "finance" can be both a category
// and an industry.
taxonomySchema.index({ kind: 1, slug: 1 }, { unique: true });
taxonomySchema.index({ kind: 1, isActive: 1, sortOrder: 1 });

export const Taxonomy = defineModel<TaxonomyDoc>("Taxonomy", taxonomySchema);

/* ────────────────────────────────────────────── embedded sub-documents */

const priceSchema = new Schema(
  {
    currency: { type: String, required: true, uppercase: true },
    amount: { type: Number, required: true, validate: Number.isInteger },
    compareAtAmount: {
      type: Number,
      validate: (v: unknown) => v == null || Number.isInteger(v),
    },
  },
  { _id: false },
);

const featureSchema = new Schema(
  { title: { type: String, required: true }, detail: String },
  { _id: false },
);

const mediaSchema = new Schema(
  {
    kind: { type: String, enum: ["screenshot", "video"], required: true },
    storageKey: String,
    url: String,
    alt: String,
    sortOrder: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

/** §65 — a licence package is what the customer actually buys. */
const licencePackageSchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    description: String,
    licenceType: { type: String, enum: LICENCE_TYPES, required: true },
    activationLimit: { type: Number, default: 1 },
    supportMonths: { type: Number, default: 12 },
    updateMonths: { type: Number, default: 12 },
    prices: { type: [priceSchema], default: [] },
  },
  { _id: false },
);

/** §49 */
const addonSchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    description: String,
    pricingType: { type: String, enum: ADDON_PRICING_TYPES, default: "fixed" },
    prices: { type: [priceSchema], default: [] },
  },
  { _id: false },
);

/**
 * §9 — demo credentials.
 *
 * `passwordCipher` holds AES-256-GCM output (ticket 07), never plaintext. The
 * field name says cipher so a plaintext write looks wrong in review.
 */
const demoCredentialSchema = new Schema(
  {
    role: { type: String, required: true },
    label: String,
    url: String,
    username: String,
    passwordCipher: {
      iv: String,
      tag: String,
      ciphertext: String,
      keyVersion: { type: Number, default: 1 },
    },
  },
  { _id: false },
);

const testingChecklistItemSchema = new Schema(
  {
    item: { type: String, required: true },
    status: { type: String, enum: ["pending", "pass", "fail", "na"], default: "pending" },
    notes: String,
    checkedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    checkedAt: Date,
  },
  { _id: false },
);

/* ────────────────────────────────────────────── Product */

export interface ProductDoc {
  _id: Types.ObjectId;
  slug: string;
  name: string;
  summary: string;
  description?: string;
  status: ProductStatus;
  categoryIds: Types.ObjectId[];
  industryIds: Types.ObjectId[];
  technologyIds: Types.ObjectId[];
  productTypeId?: Types.ObjectId;
  features: { title: string; detail?: string }[];
  requirements?: string;
  media: unknown[];
  prices: { currency: string; amount: number; compareAtAmount?: number }[];
  licencePackages: unknown[];
  addons: unknown[];
  currentVersionId?: Types.ObjectId;
  demo: {
    exposure: DemoExposure;
    publicUrl?: string;
    customerUrl?: string;
    adminUrl?: string;
    instructions?: string;
    resetSchedule?: string;
    credentials: unknown[];
  };
  customization: {
    available: boolean;
    aiWorkflowEnabled: boolean;
    technicalReviewRequired: boolean;
    startingPrice?: { amount: number; currency: string };
    typicalTurnaround?: string;
    suggestedAreas: string[];
  };
  installation: {
    selfInstall: boolean;
    innovatrixInstall: boolean;
    managedHosting: boolean;
  };
  seo: { title?: string; description?: string; ogImageUrl?: string };
  testingChecklist: unknown[];
  isFeatured: boolean;
  orderCount: number;
  adaptedCount: number;
  facets: string[];
  slugHistory: string[];
  publishedAt?: Date;
  deletedAt: Date | null;
}

const productSchema = new Schema<ProductDoc>(
  {
    slug: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    summary: { type: String, required: true },
    description: String,
    status: {
      type: String,
      enum: PRODUCT_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },

    categoryIds: { type: [Schema.Types.ObjectId], ref: "Taxonomy", default: [] },
    industryIds: { type: [Schema.Types.ObjectId], ref: "Taxonomy", default: [] },
    technologyIds: { type: [Schema.Types.ObjectId], ref: "Taxonomy", default: [] },
    productTypeId: { type: Schema.Types.ObjectId, ref: "Taxonomy" },

    features: { type: [featureSchema], default: [] },
    requirements: String,
    media: { type: [mediaSchema], default: [] },

    // §6/§43: prices are set per currency by hand. No FX conversion at read
    // time — a rate that moves must never change a displayed price.
    prices: { type: [priceSchema], default: [] },
    licencePackages: { type: [licencePackageSchema], default: [] },
    addons: { type: [addonSchema], default: [] },

    currentVersionId: { type: Schema.Types.ObjectId, ref: "ProductVersion" },

    demo: {
      exposure: { type: String, enum: DEMO_EXPOSURES, default: "authenticated" },
      publicUrl: String,
      customerUrl: String,
      adminUrl: String,
      instructions: String,
      resetSchedule: String,
      credentials: { type: [demoCredentialSchema], default: [] },
    },

    customization: {
      available: { type: Boolean, default: true },
      aiWorkflowEnabled: { type: Boolean, default: true },
      technicalReviewRequired: { type: Boolean, default: true },
      startingPrice: { type: MoneySchema, required: false },
      typicalTurnaround: String,
      // Steers the ticket-17 assistant. Structured, not prose, precisely so
      // the assistant can consume it.
      suggestedAreas: { type: [String], default: [] },
    },

    installation: {
      selfInstall: { type: Boolean, default: true },
      innovatrixInstall: { type: Boolean, default: false },
      managedHosting: { type: Boolean, default: false },
    },

    seo: { title: String, description: String, ogImageUrl: String },
    testingChecklist: { type: [testingChecklistItemSchema], default: [] },

    isFeatured: { type: Boolean, default: false },
    orderCount: { type: Number, default: 0 },
    adaptedCount: { type: Number, default: 0 },
    // Derived from the taxonomy ids — see the index note below. Written only
    // by buildProductFacets(); never edited by hand.
    facets: { type: [String], default: [] },
    // Renaming a slug must 301 the old URL (ticket 27), which needs the history.
    slugHistory: { type: [String], default: [] },
    publishedAt: Date,
    deletedAt: { type: Date, default: null },
  },
  schemaOptions({ collection: "products" }),
);

productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ slugHistory: 1 });

/**
 * §5 faceted filtering — via `facets`, not the three id arrays.
 *
 * MongoDB **cannot build a compound index across parallel arrays**: an index on
 * `{ categoryIds, industryIds, technologyIds }` is rejected outright with
 * `CannotIndexParallelArrays`, because the index would have to store the
 * cartesian product of the three. That is a hard engine constraint, not a
 * tuning choice, and it is one of the real costs of the document model for a
 * multi-facet catalogue.
 *
 * The idiomatic answer is one flattened, prefixed array — so a query filtering
 * on category AND industry AND technology is a single multikey index scan
 * rather than an index intersection the planner may decline to use. It also
 * stores slugs, so `?category=crm&industry=property` filters without first
 * resolving the taxonomy ids.
 *
 * `facets` is derived. `buildProductFacets()` is the only thing that writes it.
 */
productSchema.index({ status: 1, facets: 1 });
productSchema.index({ status: 1, isFeatured: -1, publishedAt: -1 });
productSchema.index({ status: 1, orderCount: -1 });
// Single-field multikey indexes for admin views that filter by one taxonomy.
productSchema.index({ categoryIds: 1 });
productSchema.index({ industryIds: 1 });
productSchema.index({ technologyIds: 1 });
// §74 keyword search. Atlas Search replaces this later without a data migration.
productSchema.index(
  { name: "text", summary: "text", description: "text" },
  { weights: { name: 10, summary: 5, description: 1 }, name: "product_text" },
);

export const Product = defineModel<ProductDoc>("Product", productSchema);

export const FACET_PREFIX = {
  category: "cat",
  industry: "ind",
  technology: "tech",
  productType: "type",
} as const;

/**
 * Build the flattened facet array from taxonomy slugs.
 *
 * Call this on every product write. If it drifts from the id arrays, the
 * marketplace silently stops matching — so ticket 06 re-derives it on save
 * rather than patching it incrementally.
 */
export function buildProductFacets(input: {
  categorySlugs?: string[];
  industrySlugs?: string[];
  technologySlugs?: string[];
  productTypeSlug?: string;
}): string[] {
  const facets = [
    ...(input.categorySlugs ?? []).map((s) => `${FACET_PREFIX.category}:${s}`),
    ...(input.industrySlugs ?? []).map((s) => `${FACET_PREFIX.industry}:${s}`),
    ...(input.technologySlugs ?? []).map((s) => `${FACET_PREFIX.technology}:${s}`),
    ...(input.productTypeSlug ? [`${FACET_PREFIX.productType}:${input.productTypeSlug}`] : []),
  ];
  return [...new Set(facets)].sort();
}

/** Turn marketplace query params into a `$all` facet filter (ticket 08). */
export function facetFilter(query: {
  category?: string[];
  industry?: string[];
  technology?: string[];
  productType?: string;
}): string[] {
  return buildProductFacets({
    categorySlugs: query.category,
    industrySlugs: query.industry,
    technologySlugs: query.technology,
    productTypeSlug: query.productType,
  });
}

/* ────────────────────────────────────────────── ProductVersion */

export interface ProductVersionDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  version: string;
  releaseDate?: Date;
  releaseNotes?: string;
  changelog?: string;
  minimumRequirements?: string;
  status: ProductVersionStatus;
  releasedAt?: Date;
}

const productVersionSchema = new Schema<ProductVersionDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    version: { type: String, required: true, trim: true },
    releaseDate: Date,
    releaseNotes: String,
    changelog: String,
    minimumRequirements: String,
    status: { type: String, enum: PRODUCT_VERSION_STATUSES, default: "draft" },
    // The entitlement update window is measured against this, so it is set
    // once on release and never edited (ticket 14).
    releasedAt: Date,
  },
  schemaOptions({ collection: "productVersions" }),
);

productVersionSchema.index({ productId: 1, version: 1 }, { unique: true });
productVersionSchema.index({ productId: 1, releasedAt: -1 });

export const ProductVersion = defineModel<ProductVersionDoc>(
  "ProductVersion",
  productVersionSchema,
);

/* ────────────────────────────────────────────── ProductFile */

export interface ProductFileDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  versionId: Types.ObjectId;
  kind: ProductFileKind;
  /** Unguessable object-storage key. Never a public URL (§44, §66). */
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256?: string;
  scanStatus: FileScanStatus;
  uploadedByUserId?: Types.ObjectId;
}

const productFileSchema = new Schema<ProductFileDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    versionId: {
      type: Schema.Types.ObjectId,
      ref: "ProductVersion",
      required: true,
      index: true,
    },
    kind: { type: String, enum: PRODUCT_FILE_KINDS, required: true },
    storageKey: { type: String, required: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    checksumSha256: String,
    scanStatus: { type: String, enum: FILE_SCAN_STATUSES, default: "pending" },
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  schemaOptions({ collection: "productFiles" }),
);

productFileSchema.index({ storageKey: 1 }, { unique: true });

export const ProductFile = defineModel<ProductFileDoc>("ProductFile", productFileSchema);

export type { LicenceType };
