import { Schema, type Types } from "mongoose";
import { isEmptyDocument, plainText, type RichTextDocument } from "@/lib/rich-text/schema";
import { MoneySchema, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  ADDON_PRICING_TYPES,
  DEMO_EXPOSURES,
  FILE_SCAN_STATUSES,
  LICENCE_TYPES,
  PRODUCT_FILE_KINDS,
  PRODUCT_MEDIA_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VERSION_STATUSES,
  ARTEFACT_SOURCE_STATUSES,
  DELIVERY_METHODS,
  REVIEW_REASON_CODES,
  PRODUCT_CATALOGUES,
  TAXONOMY_CATALOGUES,
  TAXONOMY_KINDS,
  type AddonPricingType,
  type DemoExposure,
  type FileScanStatus,
  type LicenceType,
  type ProductFileKind,
  type ProductMediaKind,
  type ProductStatus,
  type ProductVersionStatus,
  type ArtefactSourceStatus,
  type DeliveryMethod,
  type ReviewReasonCode,
  type ProductCatalogue,
  type TaxonomyCatalogue,
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
  /**
   * Which catalogue's vocabulary this term is part of — `both` for most.
   *
   * The filter rail renders every term of a kind and only greys out the empty
   * ones, on purpose. So scoping the *products* is not enough: without scoping
   * the vocabulary too, each catalogue advertises the other's categories.
   */
  catalogue: TaxonomyCatalogue;
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
    // `both` by default: industries and technologies genuinely are shared, and a
    // `script` default would leave `/templates` with an empty rail.
    catalogue: { type: String, enum: TAXONOMY_CATALOGUES, default: "both" },
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

/**
 * The shapes embedded in a product.
 *
 * These were `unknown[]` on `ProductDoc`, which meant TypeScript could not stop
 * `{ password: "hunter2" }` being written into `demo.credentials`. For a
 * document that is supposed to hold only ciphertext (§89), that is not a typing
 * inconvenience — it is the absence of the check that matters most.
 *
 * Every one is `{ _id: false }`: they are values owned by the product, not
 * entities with their own identity (see `ERD.md` on embed vs reference).
 */

export interface ProductPrice {
  /** ISO-4217. Widened to `string` because the *document* is not the money type. */
  currency: string;
  /** Integer minor units — §84. Never a float, never a major-unit decimal. */
  amount: number;
  /** The struck-through "was" price, when there is one. */
  compareAtAmount?: number;
}

export interface ProductFeature {
  title: string;
  detail?: string;
}

export interface ProductMedia {
  kind: ProductMediaKind;
  /** Set for uploaded media; `url` is set instead for an external video. */
  storageKey?: string;
  url?: string;
  alt?: string;
  sortOrder: number;
  isPrimary: boolean;
}

/** §65 — what the customer actually buys. */
export interface LicencePackage {
  key: string;
  name: string;
  description?: string;
  licenceType: LicenceType;
  activationLimit: number;
  supportMonths: number;
  updateMonths: number;
  prices: ProductPrice[];
}

/** §49 */
export interface Addon {
  key: string;
  name: string;
  description?: string;
  pricingType: AddonPricingType;
  prices: ProductPrice[];
}

/**
 * AES-256-GCM output — see `src/lib/crypto.ts`.
 *
 * Never logged, never placed in an audit `before`/`after`, never returned to a
 * client. The only thing that opens one is the demo service.
 */
export interface PasswordCipher {
  iv: string;
  tag: string;
  ciphertext: string;
  keyVersion: number;
}

export interface DemoCredential {
  /** Stable within a product — it is how a re-edit matches an existing row. */
  role: string;
  label?: string;
  url?: string;
  username?: string;
  passwordCipher?: PasswordCipher;
}

/**
 * One entry in a product's review history — vendor ticket 05.
 *
 * ## `internalNote` and the rule that keeps it internal
 *
 * §37's discipline, applied to a second audience. The guarantee is **not** that a
 * component hides the field: it is that the vendor-facing loader never selects it,
 * so it is absent from the payload rather than present-and-unrendered. A reviewer's
 * private assessment of somebody's code is exactly the note that must not reach
 * them, and "we styled it away" is how that leaks.
 *
 * `detail` is the opposite — it is shown to the vendor **verbatim**, which is why
 * `requestChanges` refuses an empty one.
 */
export interface ProductReviewNote {
  at: Date;
  byUserId: Types.ObjectId;
  outcome: "submitted" | "changes_requested" | "approved" | "withdrawn";
  /** Categories, so "what do reviewers keep sending back" is a query. */
  reasons: ReviewReasonCode[];
  /** Shown to the vendor verbatim. */
  detail: string;
  /** §37 — staff only. Never selected by a vendor-facing loader. */
  internalNote?: string;
  /**
   * Which sections changed since the previous approval, at the moment of this
   * submission.
   *
   * Derived from the audit log rather than stored as a diff: the audit log already
   * records changed field *names* per section save (never values — a pricing save
   * would otherwise put every price in an append-only collection), so this is a
   * summary of rows that already exist. A resubmission is usually a small change,
   * and re-reviewing the whole product is how a queue falls behind.
   */
  changedSections?: string[];
}

export interface ProductAttestation {
  at: Date;
  byUserId: Types.ObjectId;
  /** The version string the declaration was made about. */
  versionAtSubmission?: string;
  /** The exact wording accepted, so a later change of wording is visible. */
  statementVersion: string;
}

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
    kind: { type: String, enum: PRODUCT_MEDIA_KINDS, required: true },
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

/* Vendor ticket 05 — the review history and the vendor's declaration. */

/** AES-256-GCM output. Shared, because two things now store one. */
const cipherSchema = new Schema(
  {
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    ciphertext: { type: String, required: true },
    keyVersion: { type: Number, default: 1 },
  },
  { _id: false },
);

const productReviewNoteSchema = new Schema(
  {
    at: { type: Date, required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    outcome: {
      type: String,
      enum: ["submitted", "changes_requested", "approved", "withdrawn"],
      required: true,
    },
    reasons: { type: [String], enum: REVIEW_REASON_CODES, default: [] },
    detail: { type: String, required: true, trim: true },
    // §37. Present on the document, absent from every vendor-facing projection —
    // `toVendorProductView()` is the only reader a vendor gets, and it does not
    // select this field. The guarantee is the absence, not a hidden component.
    internalNote: { type: String, trim: true },
    changedSections: { type: [String], default: [] },
  },
  { _id: false },
);

const productAttestationSchema = new Schema(
  {
    at: { type: Date, required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    versionAtSubmission: { type: String, trim: true },
    statementVersion: { type: String, required: true },
  },
  { _id: false },
);

/* ────────────────────────────────────────────── Product */

export interface ProductDoc {
  _id: Types.ObjectId;
  slug: string;
  name: string;
  summary: string;
  /**
   * Who sells this — vendor ticket 04.
   *
   * **Absent means first-party**, published by CoSetup, and that is the only
   * meaning absence carries. Optional rather than required because the seeded
   * products and everything the platform sells itself have no vendor and must keep
   * working untouched; there is no house `Vendor` row and no sentinel.
   *
   * Ownership is a new axis on this collection — there was no owner field of any
   * kind before, only two audit breadcrumbs — so it needs its own index rather than
   * an extension of an existing one. `ProductVersion` and `ProductFile` derive
   * ownership through `productId` and gain no field, which is already how storage
   * authorisation works.
   */
  vendorId?: Types.ObjectId;
  /**
   * The vendor's slug and display name, denormalised.
   *
   * `vendorSlug` feeds the `vend:` facet; `vendorName` lets a marketplace card
   * attribute itself without a `$lookup` or a query per row (§94). Both are
   * derived — `Vendor` is the source of truth (§103).
   *
   * The slug is immutable once a vendor is verified, so it cannot drift. The
   * display name can change, which is why the two are separate fields and why a
   * rename has to sweep this collection.
   */
  vendorSlug?: string;
  vendorName?: string;
  /**
   * Off the marketplace without being unpublished — vendor ticket 12.
   *
   * Set when a vendor is suspended or offboarded, and cleared when they are reinstated. The
   * product keeps `status: "published"`, its URL, its publish date and its reviews; the
   * marketplace pipeline excludes it and checkout refuses it.
   *
   * Moving it to `draft` instead would have been the obvious choice and is wrong three ways: it
   * loses the publish date, it breaks every inbound link, and it makes reinstatement a
   * re-approval rather than one flag flip.
   */
  listingSuppressed?: boolean;
  /** Why an emergency delisting happened — vendor ticket 12. On the record, for the process. */
  delistedReason?: string;
  /**
   * What customers rated it — vendor ticket 10.
   *
   * ## A sum and a count, never a stored average
   *
   * `ratingSum / ratingCount` is exact integer arithmetic, and the average is derived at
   * the point of display. Storing the average would put a float in the database that can
   * disagree with the reviews behind it — the same argument §84 makes about money and §103
   * makes about the database being the source of truth.
   *
   * A **derived cache**, recomputed from the reviews inside the same transaction as every
   * review write. It exists only because a marketplace listing cannot aggregate per card;
   * the reviews remain the source of truth, and `recomputeProductRating` is the one writer.
   *
   * `ratingDistribution` is five counts, one-star first. A 4.2 average made of forty fives
   * and ten ones is a different product from one made of fifty fours, and a bare average
   * hides that.
   */
  ratingSum?: number;
  ratingCount?: number;
  ratingDistribution?: number[];
  /**
   * How this vendor supplies their bytes — vendor ticket 06.
   *
   * The seam, declared with all three values from the start so switching does not need
   * a migration. Absent means `archive`, which is what every first-party product uses
   * and what a vendor gets by default.
   */
  deliveryMethod?: DeliveryMethod;
  /**
   * What reviewers have said about this product — vendor ticket 05.
   *
   * **Appended, never overwritten.** The third submission of a product is only
   * comprehensible next to what was said about the first two, and a single "latest
   * feedback" field turns a conversation into a rumour.
   */
  reviewNotes: ProductReviewNote[];
  /**
   * The vendor's declaration, recorded with the submission that carried it.
   *
   * Not a boolean: a tick box with no timestamp and no name is a claim, and the
   * whole point of this field is to be a **defence** in a takedown (vendor ticket
   * 13). Replaced on each submission, because the attestation is about the version
   * being submitted now.
   */
  attestation?: ProductAttestation;
  /**
   * The long description, as a **ProseMirror node tree** — never an HTML
   * string, so nothing downstream is ever tempted to render it with
   * `dangerouslySetInnerHTML`. `richTextDocumentSchema` validates it on write;
   * that validation is the security boundary.
   */
  description?: RichTextDocument;
  /**
   * The same description flattened to plain text, written alongside it.
   *
   * The text index cannot score an object, so without this, enabling rich text
   * would silently break §74 keyword search — a product's body would stop being
   * searchable and nothing would error. It is derived, never edited: the one
   * writer is `descriptionFields()`.
   */
  descriptionText?: string;
  /**
   * The description was copied from a script listing and nobody has read it yet.
   *
   * The template sibling used to leave `description` empty on purpose: copying
   * prose about a working application is both a duplicate-content risk and a set
   * of behavioural claims that are false without a backend, and an empty one made
   * `no_description` force a human to write one.
   *
   * Prefilling is a real head start, and losing that gate is not an acceptable
   * price for it — a front-end listing could then be published advertising a
   * backend it does not have. So the copy comes with this flag, `no_description`
   * keeps firing while it is set, and the first Basics save clears it. Prefilled
   * *and* still blocked, which is the only version of "prefill" that is safe.
   */
  descriptionInherited?: boolean;
  status: ProductStatus;
  /**
   * Which storefront this belongs to — `script` or `template`.
   *
   * A *surface*, not a filter: it decides which grid a product appears in, not
   * which checkbox narrows it. `product_type` still says what kind of thing it is
   * (admin panel, starter kit, plugin) **within** whichever catalogue it is in.
   *
   * Required with a default, so no new document can lack it, and backfilled for
   * the ones written before it existed.
   */
  catalogue: ProductCatalogue;
  /**
   * The **full-script listing this website template is the front-end of.**
   *
   * One application is often two things worth selling: the front-end on its own,
   * and the complete working application. Those are two listings at two prices
   * with two artefacts, and this is the edge between them.
   *
   * ## Three invariants, and the direction is one of them
   *
   * - Only a `template` may carry it. A script is never the front-end of anything.
   * - The target is a `script`. So any edge is depth-1 by construction and a cycle
   *   is unrepresentable — there is no cycle check anywhere because there cannot
   *   be one.
   * - **Absence is the norm** and means nothing beyond "this is not a linked
   *   front-end". Unlike `catalogue`, which is `required` with a default and
   *   therefore needed a backfill, this field has no meaning to fill in.
   *
   * It lives on the *template* rather than the script because the checkbox that
   * creates the pair lives on the script — so the edge being here makes creating
   * the sibling a **single-document insert**, with no cross-document write and no
   * half-linked state to recover from.
   */
  scriptListingId?: Types.ObjectId;
  categoryIds: Types.ObjectId[];
  industryIds: Types.ObjectId[];
  technologyIds: Types.ObjectId[];
  productTypeId?: Types.ObjectId;
  features: ProductFeature[];
  requirements?: string;
  media: ProductMedia[];
  prices: ProductPrice[];
  licencePackages: LicencePackage[];
  addons: Addon[];
  currentVersionId?: Types.ObjectId;
  demo: {
    exposure: DemoExposure;
    publicUrl?: string;
    customerUrl?: string;
    adminUrl?: string;
    instructions?: string;
    credentials: DemoCredential[];
  };
  customization: {
    available: boolean;
    aiWorkflowEnabled: boolean;
    technicalReviewRequired: boolean;
    startingPrice?: { amount: number; currency: string };
    typicalTurnaround?: string;
    suggestedAreas: string[];
  };
  /**
   * `innovatrixInstall` keeps its name. It is a **stored field** on every product
   * document and the key in the wizard's POST body, so the CoSetup rebrand would
   * have to migrate the collection and accept a window where both spellings are
   * live — §20's "internal identifiers only where safe and beneficial", and this
   * is neither. Nothing renders it: the label a customer reads is
   * "We install it for you", which was always brand-free.
   */
  installation: {
    selfInstall: boolean;
    innovatrixInstall: boolean;
    managedHosting: boolean;
  };
  seo: { title?: string; description?: string; ogImageUrl?: string };
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
    // Vendor ticket 04. Absent ⇒ first-party.
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    vendorSlug: { type: String, lowercase: true, trim: true },
    vendorName: { type: String, trim: true },
    // Vendor ticket 12. Absent on every first-party product and on every product of a vendor
    // in good standing, which is why the pipeline filters on `$ne: true` rather than `false`.
    listingSuppressed: Boolean,
    delistedReason: { type: String, trim: true },
    // Vendor ticket 10. Integers, so the derived average cannot drift; absent on a product
    // nobody has reviewed, which is how the card and the JSON-LD know to emit nothing.
    ratingSum: { type: Number, min: 0 },
    ratingCount: { type: Number, min: 0 },
    ratingDistribution: { type: [Number], default: undefined },
    deliveryMethod: { type: String, enum: DELIVERY_METHODS },
    // Mixed, because the tree's shape is defined by Zod rather than by
    // Mongoose. A Mongoose sub-schema here would be a second, weaker copy of
    // `richTextDocumentSchema` that could drift from it.
    description: { type: Schema.Types.Mixed, default: undefined },
    descriptionText: String,
    descriptionInherited: Boolean,
    status: {
      type: String,
      enum: PRODUCT_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },

    catalogue: { type: String, enum: PRODUCT_CATALOGUES, required: true, default: "script" },
    scriptListingId: { type: Schema.Types.ObjectId, ref: "Product" },
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
      // "Anyone". A demo exists to be tried — see the Zod default's note.
      exposure: { type: String, enum: DEMO_EXPOSURES, default: "public" },
      publicUrl: String,
      customerUrl: String,
      adminUrl: String,
      instructions: String,
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

    // Vendor ticket 05 — appended, never replaced.
    reviewNotes: { type: [productReviewNoteSchema], default: [] },
    attestation: { type: productAttestationSchema },

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
 * One website template per full script — enforced by the **database**.
 *
 * ## Partial, not sparse
 *
 * `sparse: true` is the older mechanism and cannot express a second condition, so
 * it could not exclude soft-deleted rows: a template that was created, deleted and
 * created again would collide with its own tombstone forever.
 * `partialFilterExpression` can, so the guarantee is "one *live* template per
 * script" — which is the guarantee anybody actually wants.
 *
 * The service still checks first, and that check is a courtesy for the error
 * message. **This index is the authority**, the same position `slug`'s unique index
 * takes: `createTemplateSibling` catches the duplicate key and reports it in a
 * sentence rather than letting a stack trace out.
 *
 * Relaxing to several templates per script later is deleting the word `unique`.
 * No migration.
 *
 * ## Deliberately its own index
 *
 * Not folded into `{ status, catalogue, facets }`. That index's middle key is
 * equality-shaped on purpose and anything added to it strips `facets` of its
 * bounds — `config/catalogue.ts` argues that at length and it is not re-argued here.
 */
productSchema.index(
  { scriptListingId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      scriptListingId: { $type: "objectId" },
      deletedAt: null,
    },
  },
);

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
/*
 * `catalogue` sits **between** `status` and `facets`.
 *
 * Both leading keys are equality-shaped, so the planner gets point bounds on each
 * and `facets` — the multikey, and the one the facet filter needs bounded — still
 * bounds after them. That ordering is why the script predicate is an `$in` rather
 * than a `$ne`: a non-equality middle key would strip the bounds off `facets` and
 * slow every marketplace query, not only the template ones. See
 * `productCatalogueFilter` in `config/catalogue.ts`.
 */
productSchema.index({ status: 1, catalogue: 1, facets: 1 });
productSchema.index({ status: 1, isFeatured: -1, publishedAt: -1 });
productSchema.index({ status: 1, orderCount: -1 });
// The admin product list's default sort. The storefront indexes above are
// ordered for browsing, not for "what did we touch most recently".
productSchema.index({ status: 1, updatedAt: -1 });
/**
 * The vendor workspace's list — vendor ticket 04.
 *
 * A new index rather than an extension: none of the four above has room for a
 * vendor prefix, and a vendor's list is scoped *first* by owner and only then by
 * status, so the prefix has to be `vendorId`.
 *
 * Sparse, because most products have no vendor and a first-party product has no
 * business occupying a key here. The `vend:` facet serves the *marketplace*
 * filter; this serves the workspace, which needs the id rather than the slug.
 */
productSchema.index({ vendorId: 1, status: 1, updatedAt: -1 }, { sparse: true });
// Single-field multikey indexes for admin views that filter by one taxonomy.
productSchema.index({ categoryIds: 1 });
productSchema.index({ industryIds: 1 });
productSchema.index({ technologyIds: 1 });
// §74 keyword search. Atlas Search replaces this later without a data migration.
//
// `descriptionText`, not `description`: the description is a node tree, and a
// text index over an object contributes nothing — search would quietly stop
// matching on body copy. Changing the keys renames nothing, so `db:indexes`
// (syncIndexes) has to run for this to take effect on an existing database.
productSchema.index(
  { name: "text", summary: "text", descriptionText: "text" },
  { weights: { name: 10, summary: 5, descriptionText: 1 }, name: "product_text" },
);

export const Product = defineModel<ProductDoc>("Product", productSchema);

/**
 * The `$set` for a description — both fields, or neither.
 *
 * The two fields have to move together: a tree without its plain-text twin is
 * invisible to search, and a stale twin makes search return a product for words
 * that were deleted from it. Every writer goes through here so that pairing is
 * one function rather than a rule in a comment.
 *
 * An empty document clears both, so "I deleted all the copy" and "there was
 * never any copy" store identically — which is what `no_description` readiness
 * already assumes.
 */
export function descriptionFields(
  doc: RichTextDocument | null | undefined,
): Pick<ProductDoc, "description" | "descriptionText"> {
  if (isEmptyDocument(doc)) return { description: undefined, descriptionText: undefined };
  return { description: doc as RichTextDocument, descriptionText: plainText(doc) };
}

export const FACET_PREFIX = {
  category: "cat",
  industry: "ind",
  technology: "tech",
  productType: "type",
  /**
   * Who made it — vendor ticket 04.
   *
   * A fifth dimension in the flattened array rather than a field beside it,
   * because that array is the only thing that makes faceted filtering indexable:
   * MongoDB refuses a compound index across parallel arrays, which is why
   * `facets` exists at all. Filtering, facet counts, URL parsing and chip
   * rendering all come free by fitting the existing design instead of fighting it.
   */
  vendor: "vend",
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
  /** The owning vendor's slug. Absent for a first-party product. */
  vendorSlug?: string;
}): string[] {
  const facets = [
    ...(input.categorySlugs ?? []).map((s) => `${FACET_PREFIX.category}:${s}`),
    ...(input.industrySlugs ?? []).map((s) => `${FACET_PREFIX.industry}:${s}`),
    ...(input.technologySlugs ?? []).map((s) => `${FACET_PREFIX.technology}:${s}`),
    ...(input.productTypeSlug ? [`${FACET_PREFIX.productType}:${input.productTypeSlug}`] : []),
    ...(input.vendorSlug ? [`${FACET_PREFIX.vendor}:${input.vendorSlug}`] : []),
  ];
  return [...new Set(facets)].sort();
}

/**
 * The facet terms a query selects, flattened — e.g. `["cat:crm","ind:property"]`.
 *
 * This is the *terms*, not the Mongo filter. Use `facetMatch()` to build the
 * filter; see the note there about why `$all` is almost never what you want.
 */
export function facetFilter(query: FacetQuery): string[] {
  return buildProductFacets({
    categorySlugs: query.category,
    industrySlugs: query.industry,
    technologySlugs: query.technology,
    productTypeSlug: Array.isArray(query.productType)
      ? query.productType[0]
      : query.productType,
    ...(query.vendor
      ? { vendorSlug: Array.isArray(query.vendor) ? query.vendor[0] : query.vendor }
      : {}),
  });
}

export interface FacetQuery {
  category?: string[];
  industry?: string[];
  technology?: string[];
  productType?: string | string[];
  /** Vendor ticket 04. Several vendors mean "any of these", like every dimension. */
  vendor?: string | string[];
}

/**
 * Build the Mongo filter for a faceted query: **OR within a dimension, AND
 * across dimensions**.
 *
 * ## Why not `$all`
 *
 * The obvious filter is `{ facets: { $all: facetFilter(query) } }`, and it is
 * wrong in a way that returns no error and no results. `$all` means *every*
 * term must be present, so selecting two categories asks for a product filed
 * under **both** — which essentially never exists:
 *
 * ```
 * $all ["cat:crm","cat:property"] → 0 documents
 * $in  ["cat:crm","cat:property"] → 2 documents
 * ```
 *
 * What a filter rail means by two ticked categories is "either". Across
 * dimensions the meaning flips: category CRM *and* technology Laravel. Hence
 * an `$and` of per-dimension `$in`s.
 *
 * ## It still uses the index
 *
 * The first `$in` supplies the bounds on `status_1_facets_1` and the rest apply
 * as a residual filter after the fetch — verified with `explain()`: `IXSCAN`,
 * two keys examined, two documents examined for the two-dimension case. So the
 * correct semantics cost nothing.
 *
 * Returns `null` when nothing is selected, so a caller can spread it without a
 * branch: `{ status: "published", ...(facetMatch(q) ?? {}) }`.
 */
export function facetMatch(query: FacetQuery): { $and: FacetDimensionFilter[] } | null {
  const dimensions: FacetDimensionFilter[] = [];

  const add = (prefix: string, slugs: readonly string[] | undefined) => {
    const terms = [...new Set((slugs ?? []).filter(Boolean))].map((s) => `${prefix}:${s}`);
    if (terms.length > 0) dimensions.push({ facets: { $in: terms } });
  };

  add(FACET_PREFIX.category, query.category);
  add(FACET_PREFIX.industry, query.industry);
  add(FACET_PREFIX.technology, query.technology);
  add(
    FACET_PREFIX.productType,
    typeof query.productType === "string" ? [query.productType] : query.productType,
  );
  add(FACET_PREFIX.vendor, typeof query.vendor === "string" ? [query.vendor] : query.vendor);

  return dimensions.length > 0 ? { $and: dimensions } : null;
}

export interface FacetDimensionFilter {
  facets: { $in: string[] };
}

/** Split `"cat:crm"` back into its dimension and slug — for rendering chips. */
export function parseFacet(facet: string): { prefix: string; slug: string } | null {
  const index = facet.indexOf(":");
  if (index <= 0) return null;
  return { prefix: facet.slice(0, index), slug: facet.slice(index + 1) };
}

/* ────────────────────────────────────────────── ProductVersion */

/**
 * Where a mirrored or pulled artefact comes from — vendor ticket 06.
 *
 * On the *version*, not the product, because it is a per-release fact: 2.4.0 and 2.4.1
 * are different tags and different URLs. A product's `deliveryMethod` says which of
 * these fields a vendor is asked to fill in.
 *
 * `token` is sealed with the same AES-256-GCM path as a demo credential and is **never
 * rendered back** — see `version-service.saveArtefactSource`.
 */
export interface ArtefactSource {
  /** `vendor_hosted`: where the built package lives. */
  url?: string;
  /** Hex SHA-256 the vendor declares. Required for `vendor_hosted`. */
  checksumSha256?: string;
  /** `repository`: the clone/browse URL and the tag to pull. */
  repositoryUrl?: string;
  tag?: string;
  /** A sealed access token for a private repository. Write-only. */
  tokenCipher?: PasswordCipher;
  status: ArtefactSourceStatus;
  lastAttemptAt?: Date;
  failureReason?: string;
}

export interface ProductVersionDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  version: string;
  releaseDate?: Date;
  /**
   * The customer-facing "what's new", as a node tree — same reasoning as
   * `ProductDoc.description`. Unlike the description it needs no plain-text
   * twin: nothing text-indexes a version.
   */
  releaseNotes?: RichTextDocument;
  /** One line for the version list. Plain text, because that is all it is. */
  changelog?: string;
  minimumRequirements?: string;
  status: ProductVersionStatus;
  releasedAt?: Date;
  /**
   * §45 — which existing entitlements get this version without paying again.
   *
   * Ticket 07 requires this and says the rule is "declared here, enforced in
   * ticket 14" — but enforcement needs a field to read, and ticket 02 never
   * added one. Declared now so the rule can actually be recorded at release
   * time rather than reconstructed later from release notes.
   *
   * - `includesPriorMajor` — a 2.x buyer gets 3.0 free.
   * - `freeFromVersion` — the oldest version whose owners get this free.
   * - `note` — the human sentence shown on the download page.
   */
  updateEligibility?: {
    includesPriorMajor: boolean;
    freeFromVersion?: string;
    note?: string;
  };
  /** Vendor ticket 06. Absent for an archive upload, which needs no source. */
  artefactSource?: ArtefactSource;
}

const productVersionSchema = new Schema<ProductVersionDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    version: { type: String, required: true, trim: true },
    releaseDate: Date,
    releaseNotes: { type: Schema.Types.Mixed, default: undefined },
    changelog: String,
    minimumRequirements: String,
    status: { type: String, enum: PRODUCT_VERSION_STATUSES, default: "draft" },
    // The entitlement update window is measured against this, so it is set
    // once on release and never edited (ticket 14).
    releasedAt: Date,
    updateEligibility: {
      includesPriorMajor: { type: Boolean, default: false },
      freeFromVersion: String,
      note: String,
    },
    artefactSource: {
      url: { type: String, trim: true },
      checksumSha256: { type: String, trim: true, lowercase: true },
      repositoryUrl: { type: String, trim: true },
      tag: { type: String, trim: true },
      // Sealed, and `select: false` so a stray `find()` cannot carry ciphertext out of
      // the service that owns it — the same treatment demo credentials get.
      /*
       * `select: false` on the **path**, not on each leaf.
       *
       * Marking the leaves individually looked equivalent and is not: the parent path
       * still materialises, and `.select("+artefactSource.tokenCipher")` cannot re-add
       * leaves it does not name. A sub-schema makes it one path to exclude and one to
       * ask back for.
       */
      tokenCipher: { type: cipherSchema, select: false },
      status: { type: String, enum: ARTEFACT_SOURCE_STATUSES, default: "pending" },
      lastAttemptAt: Date,
      failureReason: { type: String, trim: true },
    },
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
// Publish readiness asks "does this version have an application package?" for
// a page of products at once; without this it is a collection scan per row.
productFileSchema.index({ versionId: 1, kind: 1 });

export const ProductFile = defineModel<ProductFileDoc>("ProductFile", productFileSchema);

export type { LicenceType };

/* ────────────────────────────────────────────── SavedProduct */

/**
 * A bookmark — §6's "Save for Later".
 *
 * ## Keyed on the **user**, not the organisation
 *
 * Everything else transactional in this platform is org-scoped, so this is a
 * deliberate exception and worth stating. A bookmark is a personal note about
 * something you might want; it is not a purchase, an entitlement or anything
 * anyone else in the organisation has a claim on. Org-scoping it would mean
 * your saved list changes when you switch organisations — and that your
 * colleagues can see what you have been considering.
 *
 * The unique index is what makes "save" idempotent: clicking twice is one row,
 * without a read-then-write race in between.
 */
export interface SavedProductDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  productId: Types.ObjectId;
}

const savedProductSchema = new Schema<SavedProductDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  },
  schemaOptions({ collection: "savedProducts" }),
);

savedProductSchema.index({ userId: 1, productId: 1 }, { unique: true });
// The list read: one user's saves, newest first.
savedProductSchema.index({ userId: 1, createdAt: -1 });

export const SavedProduct = defineModel<SavedProductDoc>("SavedProduct", savedProductSchema);

/* ────────────────────────────────────────────── SearchLog */

/**
 * Searches that found nothing — §74's "that list is a product-roadmap input".
 *
 * ## Only the misses are recorded
 *
 * Logging every search would be an analytics pipeline, and this is not one. The
 * question the business actually has is "what are people asking for that we do
 * not sell", and a successful search does not answer it. Storing only the
 * zero-result queries keeps the collection small enough to read by hand, which
 * is what makes it useful.
 *
 * ## No user id
 *
 * A search term is a statement of intent and often of circumstance — "redundancy
 * tracker", "insolvency" — and tying it to a person turns a roadmap input into a
 * profile. The count is what matters; who typed it is not.
 *
 * `expires` gives MongoDB a TTL: 180 days is long enough to see a seasonal
 * pattern and short enough that this never becomes a data-retention question.
 */
export interface SearchLogDoc {
  _id: Types.ObjectId;
  /** Normalised — lowercased and collapsed — so counts group properly. */
  term: string;
  count: number;
  lastSeenAt: Date;
  /** Which filters were active. A miss under three filters is a different fact. */
  hadFilters: boolean;
}

const searchLogSchema = new Schema<SearchLogDoc>(
  {
    term: { type: String, required: true, trim: true, lowercase: true },
    count: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: Date.now },
    hadFilters: { type: Boolean, default: false },
  },
  schemaOptions({ collection: "searchLogs" }),
);

// Upserted on, so one row per term rather than one per search.
searchLogSchema.index({ term: 1 }, { unique: true });
searchLogSchema.index({ count: -1, lastSeenAt: -1 });
searchLogSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

export const SearchLog = defineModel<SearchLogDoc>("SearchLog", searchLogSchema);
