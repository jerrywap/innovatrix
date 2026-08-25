import type { ProductCatalogue, ProductStatus } from "@/lib/db/enums";

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
  | "no_description"
  | "description_inherited"
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
  /**
   * The description is a copy from the script listing that nobody has read.
   *
   * A separate signal from `hasDescription`, because the two need different words:
   * one says "write something", the other says "read what we wrote for you". Both
   * block publish.
   */
  descriptionInherited?: boolean;
  hasReleasedVersion: boolean;
  hasReleasedVersionWithPackage: boolean;
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
  } else if (snapshot.descriptionInherited) {
    /*
     * There *is* a description, and it was copied from the script listing.
     *
     * `createTemplateSibling` used to leave it empty precisely so this gap would
     * fire; prefilling it would have satisfied the gap with prose that describes a
     * backend the template does not have. So the flag keeps the gap alive with its
     * own wording, and the first Basics save clears it.
     *
     * `else if`, not a second gap: "write one" and "read this one" are the same
     * blocker at different stages, and showing both would ask the vendor to do two
     * things when there is one.
     */
    gaps.push({
      code: "description_inherited",
      message:
        "Read the description — it was copied from the script listing and describes a backend this template does not have",
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

  return { gaps, isPublishable: gaps.length === 0 };
}
