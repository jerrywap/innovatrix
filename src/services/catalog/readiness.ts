import type { ProductCatalogue, ProductStatus, TestingChecklistStatus } from "@/lib/db/enums";

/**
 * What is stopping this product going live — §46, §47.
 *
 * **Pure.** No database, no imports from repositories, no request context. That
 * matters for one specific reason: the publish gate and the product list's
 * "gaps blocking publish" column both read this function. A column computed by
 * a different code path than the one that refuses the publish is worse than no
 * column at all — it tells an administrator the product is ready and then the
 * button says otherwise.
 *
 * Being pure also means it is unit-testable without a database, which is where
 * the interesting cases live: an `na` checklist item with a note passes and one
 * without a note does not.
 */

/** Stable codes so a gap can be mapped to the wizard step that fixes it. */
export type ReadinessGapCode =
  | "no_price"
  | "no_licence_package"
  | "no_screenshot"
  | "no_released_version"
  | "no_package_file"
  | "testing_incomplete"
  | "testing_failed"
  | "no_description"
  | "unbuyable_currency"
  | "no_template_category";

export interface ReadinessGap {
  code: ReadinessGapCode;
  /** Customer-facing. Shown verbatim in the refusal and in the list column. */
  message: string;
  /** The wizard section that fixes it — `steps.ts` turns this into a link. */
  section: ProductSection;
}

/** Wizard sections, in order. Kept here so `readiness` has no import cycle. */
export type ProductSection =
  | "basics"
  | "classification"
  | "content"
  | "media"
  | "pricing"
  | "options"
  | "demo"
  | "versions"
  | "testing"
  | "seo"
  | "review";

/**
 * Everything the checks below need, and nothing else.
 *
 * A flat snapshot rather than a `ProductDoc` so the function stays pure and the
 * caller has to state explicitly where each fact came from — in particular
 * `hasReleasedVersionWithPackage`, which is two collections away and is the
 * only fact the product document cannot answer on its own.
 */
export interface ReadinessSnapshot {
  status: ProductStatus;
  priceCount: number;
  licencePackageCount: number;
  screenshotCount: number;
  hasDescription: boolean;
  hasReleasedVersion: boolean;
  hasReleasedVersionWithPackage: boolean;
  checklist: ReadonlyArray<{ status: TestingChecklistStatus; notes?: string }>;
  /**
   * Currencies on `product.prices` that no licence package is priced in.
   *
   * The marketplace advertises from `product.prices`; the cart charges from
   * `licencePackages[].prices`. When those disagree the listing shows a price
   * in a currency the basket can never build a line in — see
   * `unbuyable_currency` below.
   */
  currenciesWithoutLicencePrice: readonly string[];
  /** Which storefront it will appear in. */
  catalogue: ProductCatalogue;
  /**
   * Categories on this product that its **own** catalogue permits.
   *
   * Counted by the caller rather than derived here, because scoping a term needs
   * a database read and this function is pure — the same reason
   * `hasReleasedVersionWithPackage` is handed in.
   */
  catalogueCategoryCount: number;
}

export interface Readiness {
  gaps: ReadinessGap[];
  /** Nothing missing — `publish` will not be refused on completeness grounds. */
  isPublishable: boolean;
  /** The §47 checklist is done, which is what gates entry to `ready`. */
  isTestingComplete: boolean;
}

export function computeReadiness(snapshot: ReadinessSnapshot): Readiness {
  const gaps: ReadinessGap[] = [];

  if (snapshot.priceCount === 0) {
    gaps.push({
      code: "no_price",
      message: "Add at least one price",
      section: "pricing",
    });
  }

  /*
   * A template with no template category is unreachable.
   *
   * `/templates` browses by category — that is what the catalogue split is for —
   * so a template carrying none appears only in the unfiltered grid and drops off
   * it the moment anybody filters. The first readiness gap pointing at
   * `classification`; `steps.ts` turns that into a link with no change.
   *
   * **Templates only, deliberately.** Scripts have been publishable without a
   * category since ticket 06, and gating them now would retro-flag every
   * published product in the admin list — a different decision, and not this one.
   */
  if (snapshot.catalogue === "template" && snapshot.catalogueCategoryCount === 0) {
    gaps.push({
      code: "no_template_category",
      message: "Choose at least one template category",
      section: "classification",
    });
  }

  /**
   * Not in the ticket, and it should be. `addToCartSchema` requires a
   * `licencePackageKey`, so a published product with no licence package is a
   * live listing nobody can buy — the worst kind of bug, because it looks
   * like it works.
   */
  if (snapshot.licencePackageCount === 0) {
    gaps.push({
      code: "no_licence_package",
      message: "Add a licence package — without one the product cannot be bought",
      section: "pricing",
    });
  }

  /**
   * The advertised price and the chargeable price must agree on currency.
   *
   * Also not in the ticket, and found the same way — by a customer being unable
   * to buy. `product.prices` is what the marketplace lists and filters on;
   * `licencePackages[].prices` is what the cart builds a line from. Give a
   * product a USD price but leave its licence package GBP-only and the listing
   * advertises $483, the product page shows it, and Add to basket refuses —
   * with a currency-conflict message, which sends the customer looking for a
   * conflict that isn't there.
   *
   * A gap rather than a validation error on save, so a half-finished product
   * can still be saved; it blocks publishing, which is the point at which a
   * customer could hit it.
   */
  if (snapshot.currenciesWithoutLicencePrice.length > 0) {
    const list = [...snapshot.currenciesWithoutLicencePrice].sort().join(", ");
    gaps.push({
      code: "unbuyable_currency",
      message:
        `Priced in ${list} but no licence package is — the listing would show a price ` +
        `nobody can check out with`,
      section: "pricing",
    });
  }

  if (snapshot.screenshotCount === 0) {
    gaps.push({
      code: "no_screenshot",
      message: "Add at least one screenshot",
      section: "media",
    });
  }

  if (!snapshot.hasDescription) {
    gaps.push({
      code: "no_description",
      message: "Write the full description",
      section: "basics",
    });
  }

  if (!snapshot.hasReleasedVersion) {
    gaps.push({
      code: "no_released_version",
      message: "Release a version",
      section: "versions",
    });
  } else if (!snapshot.hasReleasedVersionWithPackage) {
    // A released version with nothing to download is the subtler failure: the
    // product looks complete until someone pays for it.
    gaps.push({
      code: "no_package_file",
      message: "Upload an application package to the released version",
      section: "versions",
    });
  }

  const testing = checklistState(snapshot.checklist);
  if (testing === "failed") {
    gaps.push({
      code: "testing_failed",
      message: "Resolve the failed testing checks",
      section: "testing",
    });
  } else if (testing === "incomplete") {
    gaps.push({
      code: "testing_incomplete",
      message: "Complete the internal testing checklist",
      section: "testing",
    });
  }

  return {
    gaps,
    isPublishable: gaps.length === 0,
    isTestingComplete: testing === "complete",
  };
}

/**
 * §47's rule, which is stricter than it first looks.
 *
 * An empty checklist is **not** complete. A product that has never been tested
 * and one that passed every check would otherwise be indistinguishable, and the
 * whole point of the checklist is that somebody looked.
 *
 * `na` counts as done **only with a note**. Without one it is indistinguishable
 * from clicking through, which is how a checklist becomes theatre.
 */
function checklistState(
  checklist: ReadinessSnapshot["checklist"],
): "complete" | "incomplete" | "failed" {
  if (checklist.length === 0) return "incomplete";
  if (checklist.some((item) => item.status === "fail")) return "failed";

  const settled = checklist.every(
    (item) => item.status === "pass" || (item.status === "na" && Boolean(item.notes?.trim())),
  );

  return settled ? "complete" : "incomplete";
}

/** The §47 checklist an administrator starts from. */
export const DEFAULT_TESTING_CHECKLIST: readonly string[] = [
  "Installation",
  "Authentication",
  "Major workflows",
  "Demo credentials",
  "Database setup",
  "Documentation",
  "Security review",
  "Download package integrity",
  "Environment requirements",
  "Payment integrations",
];
