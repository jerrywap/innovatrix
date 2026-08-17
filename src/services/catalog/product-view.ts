import "server-only";
import type { ProductDoc } from "@/lib/db/models/catalog";
import type {
  AddonPricingType,
  DemoExposure,
  LicenceType,
  ProductMediaKind,
  ProductStatus,
  TestingChecklistStatus,
} from "@/lib/db/enums";
import type { RichTextDocument } from "@/lib/rich-text/schema";

/**
 * Document → view model.
 *
 * ## Never spread a `ProductDoc` into a prop
 *
 * Every mapper here builds its result **key by key**. That is not style; it is
 * the mechanism behind ticket 07's acceptance criterion, which asks that an
 * `owners_only` product's payload contain *no credential fields at all* — "not
 * merely hidden in the UI".
 *
 * Conditional rendering cannot deliver that: React Server Components serialise
 * the props of branches that did not render. Only a type with no such field can,
 * and the only way to be sure is to construct it explicitly. `{...product}` in
 * this file would defeat the whole design.
 *
 * ## Cache Components needs this anyway
 *
 * A `use cache` function's return value must be serializable, and Mongoose
 * hands back `ObjectId`s, which are not. Ids become strings here, which also
 * means a view model can cross to a Client Component unchanged.
 */

/* ────────────────────────────────────────────── shared pieces */

export interface PriceView {
  currency: string;
  amount: number;
  compareAtAmount?: number;
}

export interface MediaView {
  kind: ProductMediaKind;
  storageKey?: string;
  url?: string;
  alt?: string;
  sortOrder: number;
  isPrimary: boolean;
}

export interface LicencePackageView {
  key: string;
  name: string;
  description?: string;
  licenceType: LicenceType;
  activationLimit: number;
  supportMonths: number;
  updateMonths: number;
  prices: PriceView[];
}

export interface AddonView {
  key: string;
  name: string;
  description?: string;
  pricingType: AddonPricingType;
  prices: PriceView[];
}

export interface TestingChecklistView {
  item: string;
  status: TestingChecklistStatus;
  notes?: string;
  checkedAt?: string;
}

/**
 * The admin's view of a product.
 *
 * Note what is **absent**: `demo.credentials`. Even an administrator's browser
 * has no reason to hold ciphertext, and the reveal flow (ticket 07) fetches one
 * plaintext at a time through an audited action instead.
 */
export interface AdminProductView {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description?: RichTextDocument;
  status: ProductStatus;
  categoryIds: string[];
  industryIds: string[];
  technologyIds: string[];
  productTypeId?: string;
  features: Array<{ title: string; detail?: string }>;
  requirements?: string;
  media: MediaView[];
  prices: PriceView[];
  licencePackages: LicencePackageView[];
  addons: AddonView[];
  currentVersionId?: string;
  demo: {
    exposure: DemoExposure;
    publicUrl?: string;
    customerUrl?: string;
    adminUrl?: string;
    instructions?: string;
    resetSchedule?: string;
    /** Roles only — enough to render the rows, without the secrets. */
    credentialRoles: Array<{
      role: string;
      label?: string;
      username?: string;
      hasPassword: boolean;
    }>;
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
  testingChecklist: TestingChecklistView[];
  isFeatured: boolean;
  orderCount: number;
  adaptedCount: number;
  facets: string[];
  publishedAt?: string;
  updatedAt?: string;
}

export function toAdminProductView(product: ProductDoc): AdminProductView {
  return {
    id: String(product._id),
    slug: product.slug,
    name: product.name,
    summary: product.summary,
    ...(product.description ? { description: product.description } : {}),
    status: product.status,
    categoryIds: product.categoryIds.map(String),
    industryIds: product.industryIds.map(String),
    technologyIds: product.technologyIds.map(String),
    ...(product.productTypeId ? { productTypeId: String(product.productTypeId) } : {}),
    features: product.features.map((feature) => ({
      title: feature.title,
      ...(feature.detail ? { detail: feature.detail } : {}),
    })),
    ...(product.requirements ? { requirements: product.requirements } : {}),
    media: product.media.map(toMediaView),
    prices: product.prices.map(toPriceView),
    licencePackages: product.licencePackages.map((pkg) => ({
      key: pkg.key,
      name: pkg.name,
      ...(pkg.description ? { description: pkg.description } : {}),
      licenceType: pkg.licenceType,
      activationLimit: pkg.activationLimit,
      supportMonths: pkg.supportMonths,
      updateMonths: pkg.updateMonths,
      prices: pkg.prices.map(toPriceView),
    })),
    addons: product.addons.map((addon) => ({
      key: addon.key,
      name: addon.name,
      ...(addon.description ? { description: addon.description } : {}),
      pricingType: addon.pricingType,
      prices: addon.prices.map(toPriceView),
    })),
    ...(product.currentVersionId ? { currentVersionId: String(product.currentVersionId) } : {}),
    demo: {
      exposure: product.demo.exposure,
      ...(product.demo.publicUrl ? { publicUrl: product.demo.publicUrl } : {}),
      ...(product.demo.customerUrl ? { customerUrl: product.demo.customerUrl } : {}),
      ...(product.demo.adminUrl ? { adminUrl: product.demo.adminUrl } : {}),
      ...(product.demo.instructions ? { instructions: product.demo.instructions } : {}),
      ...(product.demo.resetSchedule ? { resetSchedule: product.demo.resetSchedule } : {}),
      // The rows an admin edits, minus every secret. `hasPassword` is what lets
      // the form show "•••• (unchanged)" without ever holding the value.
      credentialRoles: product.demo.credentials.map((credential) => ({
        role: credential.role,
        ...(credential.label ? { label: credential.label } : {}),
        ...(credential.username ? { username: credential.username } : {}),
        hasPassword: Boolean(credential.passwordCipher?.ciphertext),
      })),
    },
    customization: {
      available: product.customization.available,
      aiWorkflowEnabled: product.customization.aiWorkflowEnabled,
      technicalReviewRequired: product.customization.technicalReviewRequired,
      ...(product.customization.startingPrice
        ? {
            startingPrice: {
              amount: product.customization.startingPrice.amount,
              currency: product.customization.startingPrice.currency,
            },
          }
        : {}),
      ...(product.customization.typicalTurnaround
        ? { typicalTurnaround: product.customization.typicalTurnaround }
        : {}),
      suggestedAreas: [...product.customization.suggestedAreas],
    },
    installation: {
      selfInstall: product.installation.selfInstall,
      innovatrixInstall: product.installation.innovatrixInstall,
      managedHosting: product.installation.managedHosting,
    },
    seo: {
      ...(product.seo?.title ? { title: product.seo.title } : {}),
      ...(product.seo?.description ? { description: product.seo.description } : {}),
      ...(product.seo?.ogImageUrl ? { ogImageUrl: product.seo.ogImageUrl } : {}),
    },
    testingChecklist: product.testingChecklist.map((item) => ({
      item: item.item,
      status: item.status,
      ...(item.notes ? { notes: item.notes } : {}),
      ...(item.checkedAt ? { checkedAt: item.checkedAt.toISOString() } : {}),
    })),
    isFeatured: product.isFeatured,
    orderCount: product.orderCount,
    adaptedCount: product.adaptedCount,
    facets: [...product.facets],
    ...(product.publishedAt ? { publishedAt: product.publishedAt.toISOString() } : {}),
    ...(hasUpdatedAt(product) ? { updatedAt: product.updatedAt.toISOString() } : {}),
  };
}

/** The columns the admin list needs — a fraction of the document. */
export interface AdminProductRow {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  /** Vendor ticket 04. Absent ⇒ first-party, published by Innovatrix. */
  vendorName?: string;
  isFeatured: boolean;
  priceCount: number;
  screenshotCount: number;
  orderCount: number;
  updatedAt?: string;
  primaryPrice?: PriceView;
}

export function toAdminProductRow(product: ProductDoc): AdminProductRow {
  const primary = product.prices[0];

  return {
    id: String(product._id),
    slug: product.slug,
    name: product.name,
    status: product.status,
    ...(product.vendorName ? { vendorName: product.vendorName } : {}),
    isFeatured: product.isFeatured,
    priceCount: product.prices.length,
    screenshotCount: product.media.filter((item) => item.kind === "screenshot").length,
    orderCount: product.orderCount,
    ...(hasUpdatedAt(product) ? { updatedAt: product.updatedAt.toISOString() } : {}),
    ...(primary ? { primaryPrice: toPriceView(primary) } : {}),
  };
}

function toPriceView(price: { currency: string; amount: number; compareAtAmount?: number }) {
  return {
    currency: price.currency,
    amount: price.amount,
    ...(price.compareAtAmount !== undefined ? { compareAtAmount: price.compareAtAmount } : {}),
  };
}

function toMediaView(media: ProductDoc["media"][number]): MediaView {
  return {
    kind: media.kind,
    ...(media.storageKey ? { storageKey: media.storageKey } : {}),
    ...(media.url ? { url: media.url } : {}),
    ...(media.alt ? { alt: media.alt } : {}),
    sortOrder: media.sortOrder,
    isPrimary: media.isPrimary,
  };
}

/** `timestamps: true` adds these, but they are not on the declared interface. */
function hasUpdatedAt(product: ProductDoc): product is ProductDoc & { updatedAt: Date } {
  return (
    "updatedAt" in product && (product as { updatedAt?: unknown }).updatedAt instanceof Date
  );
}
