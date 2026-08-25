import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { connectToDatabase } from "@/lib/db/client";
import { Entitlement } from "@/lib/db/models/commerce";
import { FACET_PREFIX, Product, parseFacet, type ProductDoc } from "@/lib/db/models/catalog";
import type {
  LicenceType,
  ProductCatalogue,
  ProductMediaKind,
  TaxonomyKind,
} from "@/lib/db/enums";
import type { RichTextDocument } from "@/lib/rich-text/schema";
import { toObjectId } from "@/lib/db/base";
import type { StorefrontCurrency } from "@/config/storefront";
import { productCatalogueFilter } from "@/config/catalogue";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { CACHE_PROFILE, CATALOG_TAG, TAXONOMY_TAG, productTag } from "@/services/catalog/cache";
import { listCustomerVersions } from "@/services/catalog/version-service";
import { publicDemoView, type PublicDemoView } from "@/services/catalog/demo-service";
import { getTaxonomyIndex, type ProductCard } from "./index";
import { toCardsForRelated } from "./card-mapper";
import { buildMarketplacePipeline } from "./pipeline";
import type { PipelineStage } from "mongoose";
import { formatDay } from "@/lib/dates";

/**
 * The public product page's data — §8.
 *
 * ## Two functions, and the split is the security boundary
 *
 * `getProductDetail()` is **cached** and returns a type with **no credentials
 * key at all**. `getDemoAccess()` is uncached, `server-only`, and is the single
 * thing that decrypts.
 *
 * The reason it is two functions rather than one with a flag: a cached read
 * whose result varies by viewer is a cache-poisoning bug waiting to happen —
 * the first owner to load the page would put decrypted credentials into an
 * entry the next anonymous visitor reads. Keeping the secret out of the cached
 * function's *type* makes that impossible rather than merely unlikely.
 *
 * ## Prices for every storefront currency, computed on the server
 *
 * The purchase panel switches currency and licence package without a reload,
 * which means it needs every combination up front. It is handed a **table**,
 * not a rate: the client never does money arithmetic, because §84's integer
 * minor units stop being safe the moment a float is involved.
 */

export interface DetailPrice {
  currency: StorefrontCurrency;
  amount: number;
  compareAtAmount?: number;
}

export interface DetailLicencePackage {
  key: string;
  name: string;
  description?: string;
  licenceType: LicenceType;
  activationLimit: number;
  supportMonths: number;
  updateMonths: number;
  prices: DetailPrice[];
}

export interface DetailAddon {
  key: string;
  name: string;
  description?: string;
  pricingType: string;
  prices: DetailPrice[];
}

export interface DetailVersion {
  id: string;
  version: string;
  releasedAt?: string;
  changelog?: string;
  minimumRequirements?: string;
  releaseNotes?: RichTextDocument;
  updateNote?: string;
  isCurrent: boolean;
}

export interface ProductDetail {
  id: string;
  /** Which storefront it belongs to — so related products stay in it. */
  catalogue: ProductCatalogue;
  /**
   * On a website template, the full-script listing it is the front-end of.
   *
   * Only the id: the name and the price come from `getLinkedScriptListing`, which
   * is its own cached read, because a price that varies by currency cannot live in
   * this currency-agnostic entry.
   */
  scriptListingId?: string;
  slug: string;
  name: string;
  summary: string;
  description?: RichTextDocument;
  features: Array<{ title: string; detail?: string }>;
  requirements?: string;
  /**
   * Screenshots **and videos**, in sort order — narrowed from `kind: string`.
   *
   * The widened type was not harmless. Every reader treated the list as images:
   * `media[0]` became the hero `<Image>`, the same entry became the Open Graph
   * image, and the whole array went to the gallery. So a product whose first
   * media entry is a video rendered an `<Image src="…mp4">` as its LCP element
   * and advertised it to every crawler. `screenshots()` below is what readers
   * should use; the union is what makes forgetting a compile error rather than a
   * broken page.
   */
  media: Array<{ kind: ProductMediaKind; url: string; alt: string }>;
  prices: DetailPrice[];
  licencePackages: DetailLicencePackage[];
  addons: DetailAddon[];
  installation: { selfInstall: boolean; innovatrixInstall: boolean; managedHosting: boolean };
  customization: {
    available: boolean;
    aiWorkflowEnabled: boolean;
    typicalTurnaround?: string;
    startingPrice?: DetailPrice;
    suggestedAreas: string[];
  };
  taxonomy: {
    categories: Array<{ slug: string; name: string }>;
    industries: Array<{ slug: string; name: string }>;
    technologies: Array<{ slug: string; name: string }>;
    productType?: { slug: string; name: string };
  };
  versions: DetailVersion[];
  /**
   * Roles and a `hasPassword` flag. **Never** a username, a password or a
   * gated URL — see `publicDemoView`.
   */
  demo: PublicDemoView;
  /**
   * Who sells it — vendor ticket 11. Absent ⇒ first-party.
   *
   * Both fields or neither: a name with no slug could not be linked, and the link is the point
   * — attribution that a buyer cannot follow answers "who made this" without answering "what
   * else have they made".
   */
  vendor?: { slug: string; name: string };
  /**
   * The rating, derived — vendor ticket 10.
   *
   * Absent when nobody has reviewed it, and that absence is load-bearing twice over: the page
   * renders no star row, and `ProductJsonLd` emits no `AggregateRating`. A zeroed object would
   * do neither of those things and would publish a fabricated rating, which is a
   * structured-data policy violation with a manual action attached.
   */
  rating?: { average: number; count: number; distribution: number[] };
  seo: { title?: string; description?: string; ogImageUrl?: string };
  publishedAt?: string;
  updatedAt?: string;
}

/* ────────────────────────────────────────────── the cached read */

/**
 * The images, and only the images.
 *
 * One function so the hero, the Open Graph tag and the gallery cannot disagree
 * about what counts as a picture — they each filtered, or failed to filter,
 * independently, and the one that failed to was the one a crawler reads.
 *
 * A pure helper rather than a second field on the DTO: the video entries are
 * still wanted (a player is the obvious next thing), so dropping them from the
 * payload would throw away data to save a `.filter`.
 */
export function screenshots(media: ProductDetail["media"]): ProductDetail["media"] {
  return media.filter((item) => item.kind === "screenshot");
}

export async function getProductDetail(slug: string): Promise<ProductDetail | null> {
  "use cache";
  cacheTag(CATALOG_TAG, TAXONOMY_TAG, productTag(slug));
  cacheLife(CACHE_PROFILE.product);

  await connectToDatabase();

  const product = await Product.findOne({
    slug,
    status: "published",
    deletedAt: null,
    // Vendor ticket 12. A suspended vendor's product keeps its URL — for the customer who
    // already bought it and follows a link from My Scripts — but it is not *sold* here, and
    // the purchase panel is what enforces that. See `cart-service`, which refuses the line.
  })
    // Excluded at the query, not at the mapping. Belt and braces: even a future
    // `...product` spread in a mapper cannot leak what was never fetched.
    .select({ "demo.credentials.passwordCipher": 0 })
    // `timestamps` is on in `schemaOptions`, but `ProductDoc` does not declare
    // the fields it adds — widened here rather than in the shared interface,
    // since only the SEO `lastModified` needs them.
    .lean<ProductDoc & { updatedAt?: Date }>();

  if (!product) return null;

  const [taxonomy, versions] = await Promise.all([
    getTaxonomyIndex(),
    listCustomerVersions(String(product._id)),
  ]);

  const nameOf = (kind: TaxonomyKind, prefix: string) => {
    const names = new Map(taxonomy[kind].map((term) => [term.slug, term.name]));
    return (product.facets ?? [])
      .map(parseFacet)
      .filter((facet): facet is { prefix: string; slug: string } => facet?.prefix === prefix)
      .map((facet) => ({ slug: facet.slug, name: names.get(facet.slug) ?? facet.slug }));
  };

  const currentVersionId = product.currentVersionId
    ? String(product.currentVersionId)
    : undefined;

  return {
    id: String(product._id),
    catalogue: product.catalogue ?? "script",
    ...(product.scriptListingId ? { scriptListingId: String(product.scriptListingId) } : {}),
    slug: product.slug,
    name: product.name,
    summary: product.summary,
    ...(product.description ? { description: product.description } : {}),
    features: (product.features ?? []).map((feature) => ({
      title: feature.title,
      ...(feature.detail ? { detail: feature.detail } : {}),
    })),
    ...(product.requirements ? { requirements: product.requirements } : {}),
    media: (product.media ?? [])
      .filter((item) => Boolean(item.url))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        kind: item.kind as ProductMediaKind,
        url: item.url!,
        alt: item.alt ?? product.name,
      })),
    ...(product.vendorSlug && product.vendorName
      ? { vendor: { slug: product.vendorSlug, name: product.vendorName } }
      : {}),
    // Derived here rather than stored: `ratingSum / ratingCount` is exact integer
    // arithmetic, and a stored average is a float that can disagree with its own reviews.
    ...(product.ratingCount && product.ratingSum
      ? {
          rating: {
            average: Math.round((product.ratingSum / product.ratingCount) * 10) / 10,
            count: product.ratingCount,
            distribution: product.ratingDistribution ?? [0, 0, 0, 0, 0],
          },
        }
      : {}),
    prices: storefrontPrices(product.prices),
    licencePackages: (product.licencePackages ?? []).map((pkg) => ({
      key: pkg.key,
      name: pkg.name,
      ...(pkg.description ? { description: pkg.description } : {}),
      licenceType: pkg.licenceType,
      activationLimit: pkg.activationLimit,
      supportMonths: pkg.supportMonths,
      updateMonths: pkg.updateMonths,
      prices: storefrontPrices(pkg.prices),
    })),
    addons: (product.addons ?? []).map((addon) => ({
      key: addon.key,
      name: addon.name,
      ...(addon.description ? { description: addon.description } : {}),
      pricingType: addon.pricingType,
      prices: storefrontPrices(addon.prices),
    })),
    installation: {
      selfInstall: Boolean(product.installation?.selfInstall),
      innovatrixInstall: Boolean(product.installation?.innovatrixInstall),
      managedHosting: Boolean(product.installation?.managedHosting),
    },
    customization: {
      available: Boolean(product.customization?.available),
      aiWorkflowEnabled: Boolean(product.customization?.aiWorkflowEnabled),
      ...(product.customization?.typicalTurnaround
        ? { typicalTurnaround: product.customization.typicalTurnaround }
        : {}),
      ...(product.customization?.startingPrice
        ? { startingPrice: storefrontPrices([product.customization.startingPrice])[0]! }
        : {}),
      suggestedAreas: product.customization?.suggestedAreas ?? [],
    },
    taxonomy: {
      categories: nameOf("category", "cat"),
      industries: nameOf("industry", "ind"),
      technologies: nameOf("technology", "tech"),
      ...(nameOf("product_type", "type")[0]
        ? { productType: nameOf("product_type", "type")[0]! }
        : {}),
    },
    versions: versions.map((version) => ({
      id: String(version._id),
      version: version.version,
      ...(version.releasedAt ? { releasedAt: formatDay(version.releasedAt) } : {}),
      ...(version.changelog ? { changelog: version.changelog } : {}),
      ...(version.minimumRequirements
        ? { minimumRequirements: version.minimumRequirements }
        : {}),
      ...(version.releaseNotes ? { releaseNotes: version.releaseNotes } : {}),
      ...(version.updateEligibility?.note
        ? { updateNote: version.updateEligibility.note }
        : {}),
      isCurrent: String(version._id) === currentVersionId,
    })),
    demo: publicDemoView(product),
    seo: {
      ...(product.seo?.title ? { title: product.seo.title } : {}),
      ...(product.seo?.description ? { description: product.seo.description } : {}),
      ...(product.seo?.ogImageUrl ? { ogImageUrl: product.seo.ogImageUrl } : {}),
    },
    ...(product.publishedAt ? { publishedAt: formatDay(product.publishedAt) } : {}),
    ...(product.updatedAt ? { updatedAt: formatDay(product.updatedAt) } : {}),
  };
}

/**
 * A slug that used to belong to a product — §93's 301 path.
 *
 * Separate from `getProductDetail` because the answer is different in kind: a
 * *redirect*, not a page. Returning "the product, but at a different address"
 * from one function would put the responsibility for noticing on every caller.
 */
export async function getCurrentSlugFor(oldSlug: string): Promise<string | null> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife(CACHE_PROFILE.product);

  await connectToDatabase();

  const moved = await Product.findOne({
    slugHistory: oldSlug,
    status: "published",
    deletedAt: null,
  })
    .select({ slug: 1 })
    .lean<{ slug: string }>();

  return moved?.slug ?? null;
}

/** Published slugs, for `generateStaticParams`. Bounded — the rest render on demand. */
export async function getPrerenderSlugs(limit = 100): Promise<string[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife(CACHE_PROFILE.listing);

  await connectToDatabase();

  const rows = await Product.find({ status: "published", deletedAt: null })
    // The most-bought products are the ones worth having warm.
    .sort({ orderCount: -1, publishedAt: -1 })
    .limit(limit)
    .select({ slug: 1 })
    .lean<Array<{ slug: string }>>();

  return rows.map((row) => row.slug);
}

/* ────────────────────────────────────────────── related */

/**
 * Same category or industry — §5.10.
 *
 * Reuses the marketplace pipeline rather than writing a second product query,
 * so the card shape, the price logic and the projection cannot drift from the
 * grid. `$ne` on the id excludes the product being viewed, which is otherwise
 * the most related product of all.
 */
/**
 * The full-script listing a website template is the front-end of.
 *
 * ## Deliberately not a variation of `getRelatedProducts`
 *
 * That function applies `productCatalogueFilter(detail.catalogue)` on purpose —
 * "'you might also like' pointing from a Tailwind template to a Laravel CRM is the
 * split leaking at the most visible moment". This one's entire job is to cross the
 * split, **once**, for exactly one document that a human deliberately linked. Those
 * are opposite requirements, so they are separate functions rather than one with a
 * flag.
 *
 * ## Both slugs are tagged
 *
 * The template's, so an unlink dumps the entry; and the **script's**, read from the
 * document after the query, so repricing or renaming the script does too. Without
 * the second tag the banner would advertise a stale price for up to an hour — for a
 * page one click away, which reads worse than one stale price on one page.
 *
 * ## Every currency, not the viewer's
 *
 * Returning the whole storefront price list keeps this entry currency-agnostic,
 * like `getProductDetail`. Taking a currency parameter would put it in the cache
 * key and multiply the entries by three for no benefit — the component picks.
 */
export interface LinkedScriptListing {
  slug: string;
  name: string;
  prices: DetailPrice[];
}

export async function getLinkedScriptListing(
  scriptProductId: string,
  templateSlug: string,
): Promise<LinkedScriptListing | null> {
  "use cache";
  cacheTag(CATALOG_TAG, productTag(templateSlug));
  cacheLife(CACHE_PROFILE.product);

  await connectToDatabase();

  const found = await Product.findOne({
    _id: toObjectId(scriptProductId),
    status: "published",
    deletedAt: null,
    /*
     * A **deliberate asymmetry** with `getProductDetail`, which does not filter
     * this: serving a URL somebody already has is one thing, actively cross-selling
     * into a suspended vendor's catalogue is another.
     */
    listingSuppressed: { $ne: true },
    // Total, and one query: guards the case where somebody later moves the target
    // into the template catalogue and leaves the pointer behind.
    ...productCatalogueFilter("script"),
  })
    .select({ slug: 1, name: 1, prices: 1 })
    .lean<Pick<ProductDoc, "slug" | "name" | "prices">>();

  if (!found) return null;

  // After the read, from awaited data — supported, and the only way to tag the
  // entry with a slug this function did not receive.
  cacheTag(productTag(found.slug));

  return {
    slug: found.slug,
    name: found.name,
    prices: storefrontPrices(found.prices),
  };
}

export async function getRelatedProducts(
  detail: ProductDetail,
  currency: StorefrontCurrency,
  limit = 3,
): Promise<ProductCard[]> {
  "use cache";
  cacheTag(CATALOG_TAG, TAXONOMY_TAG, productTag(detail.slug));
  cacheLife(CACHE_PROFILE.product);

  /*
   * Through `FACET_PREFIX`, not hand-written strings.
   *
   * These were `cat:` and `ind:` literals, which happened to be right and would
   * have gone silently wrong the first time a prefix was renamed or a dimension
   * added — the failure being "related products stops finding anything", with no
   * error. `FACET_PREFIX` is the one place that decides.
   */
  const facets = [
    ...detail.taxonomy.categories.map((term) => `${FACET_PREFIX.category}:${term.slug}`),
    ...detail.taxonomy.industries.map((term) => `${FACET_PREFIX.industry}:${term.slug}`),
  ];
  if (facets.length === 0) return [];

  await connectToDatabase();

  const [result] = await Product.aggregate<{ rows: Array<Record<string, unknown>> }>([
    {
      $match: {
        status: "published",
        deletedAt: null,
        _id: { $ne: toObjectId(detail.id) },
        facets: { $in: facets },
        /*
         * Related products stay in the same catalogue. Another of the three
         * readers that skip stage one, so `primaryMatch`'s predicate never gets
         * here — and "you might also like" pointing from a Tailwind template to a
         * Laravel CRM is the split leaking at the most visible moment.
         */
        ...productCatalogueFilter(detail.catalogue),
      },
    },
    ...(buildMarketplacePipeline({
      sort: "popular",
      page: 1,
      limit,
      currency,
      catalogue: detail.catalogue,
    }).slice(1) as unknown as PipelineStage[]),
  ] as PipelineStage[]);

  return toCardsForRelated(
    result?.rows ?? [],
    await getTaxonomyIndex(detail.catalogue),
    currency,
  );
}

/* ────────────────────────────────────────────── ownership */

/**
 * Does this organisation own the product?
 *
 * Real today rather than a stub: `Entitlement` and its indexes exist from
 * ticket 02 and the seed already creates one, so the owner path is testable
 * now instead of being a branch nobody has run.
 *
 * `active` only — a refunded or revoked entitlement is a record that a purchase
 * happened, not a licence to see the demo credentials.
 */
export async function viewerOwnsProduct(
  organizationId: string | undefined,
  productId: string,
): Promise<boolean> {
  if (!organizationId) return false;

  await connectToDatabase();

  const owned = await Entitlement.exists({
    organizationId: toObjectId(organizationId),
    productId: toObjectId(productId),
    status: "active",
  });

  return owned !== null;
}

/* ────────────────────────────────────────────── internals */

/** Drop any currency the storefront does not sell in, and keep a stable order. */
function storefrontPrices(
  prices:
    ReadonlyArray<{ currency: string; amount: number; compareAtAmount?: number }> | undefined,
): DetailPrice[] {
  const byCurrency = new Map(
    (prices ?? []).map((price) => [price.currency.toUpperCase(), price]),
  );

  return STOREFRONT_CURRENCIES.flatMap((currency) => {
    const price = byCurrency.get(currency);
    if (!price) return [];
    return [
      {
        currency,
        amount: price.amount,
        ...(price.compareAtAmount ? { compareAtAmount: price.compareAtAmount } : {}),
      },
    ];
  });
}
