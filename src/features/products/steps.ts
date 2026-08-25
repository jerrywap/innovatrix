import type { Route } from "next";
import type { Permission } from "@/lib/auth/permissions";
import type { ProductSection } from "@/services/catalog/readiness";

/**
 * The product wizard's sections — §42.
 *
 * Pure data. Read by the wizard layout (to draw the Stepper), by the product
 * list (to link each publish gap to the step that fixes it), and by tests. One
 * definition, so a step cannot exist in the navigation and not in the router.
 *
 * ## Ten sections, not §42's thirteen
 *
 * §42 lists thirteen. Three of them are single-field forms, and it splits
 * licensing from pricing, which nobody experiences as two decisions. The
 * mapping, stated openly rather than done quietly:
 *
 * | Section here      | §42 steps                          |
 * |-------------------|------------------------------------|
 * | `basics`          | Basic information                  |
 * | `classification`  | Category / industry / technology   |
 * | `content`         | Features + Technology & requirements |
 * | `media`           | Media                              |
 * | `pricing`         | Pricing + Licensing + Add-ons      |
 * | `versions`        | Product files + Versions           |
 * | `demo`            | Demo + Test credentials            |
 * | `options`         | Installation + Customization       |
 * | `testing`         | Internal testing checklist (§47)   |
 * | `seo`             | SEO                                |
 * | `review`          | Review & publish                   |
 *
 * The Stepper labels stay close to §42's wording so the spec still reads as
 * satisfied.
 *
 * ## Why named routes rather than one `[section]` segment
 *
 * `typedRoutes` is on, and this codebase treats it as load-bearing. With
 * `/admin/products/[id]/[section]` the `Route` type collapses to a template
 * literal, so every typo compiles and the guarantee evaporates exactly where
 * the app first grows dynamic routes. With one folder per section,
 * `` `/admin/products/${id}/pricing` `` is checked against a route that
 * actually exists — which is what lets a readiness gap be a *link*.
 */

export interface WizardStep {
  id: ProductSection;
  /** Shown in the Stepper. */
  label: string;
  /** One line under the heading, saying what this step is for. */
  description: string;
  /** Path segment. Matches the folder under `/admin/products/[id]/`. */
  segment: string;
  /**
   * The permission this step's *save* needs.
   *
   * Mostly `product.update`, but pricing is separate: §77 gives
   * `product.manage_pricing` to `sales` and `finance`, who have no business
   * editing a description, and withholds it from `content_manager`, who does.
   */
  permission: Permission;
  /** Handed to ticket 07 — the section exists but its body lands there. */
  ticket?: "07";
}

export const PRODUCT_WIZARD_STEPS: readonly WizardStep[] = [
  {
    id: "basics",
    label: "Basics",
    description: "Name, summary and the full description customers read first.",
    segment: "basics",
    permission: "product.update",
  },
  {
    id: "classification",
    label: "Classification",
    description: "Product Classification",
    segment: "classification",
    permission: "product.update",
  },
  {
    id: "content",
    label: "Features",
    description: "What it does, and what it needs to run.",
    segment: "content",
    permission: "product.update",
  },
  {
    id: "media",
    label: "Media",
    description: "Screenshots and video. The first screenshot is the marketplace card.",
    segment: "media",
    permission: "product.update",
  },
  {
    id: "pricing",
    label: "Pricing",
    description: "Prices per currency, licence packages and service add-ons.",
    segment: "pricing",
    permission: "product.manage_pricing",
  },
  {
    id: "versions",
    label: "Versions",
    description: "Releases and the files customers download.",
    segment: "versions",
    permission: "product.manage_files",
    ticket: "07",
  },
  {
    id: "demo",
    label: "Demo",
    description: "Demo URLs and test credentials, and who may see them.",
    segment: "demo",
    permission: "product.update",
    ticket: "07",
  },
  {
    id: "options",
    label: "Options",
    description: "Installation choices and what may be customised.",
    segment: "options",
    permission: "product.update",
  },
  {
    id: "testing",
    label: "Testing",
    description: "The internal checklist that has to pass before release.",
    segment: "testing",
    permission: "product.update",
    ticket: "07",
  },
  {
    id: "seo",
    label: "SEO",
    description: "How this product appears in search results and shared links.",
    segment: "seo",
    permission: "product.update",
  },
  {
    id: "review",
    label: "Review",
    description: "What is left to do, and publishing.",
    segment: "review",
    permission: "product.update",
  },
];

const BY_ID = new Map(PRODUCT_WIZARD_STEPS.map((step) => [step.id, step]));

export function stepFor(section: ProductSection): WizardStep | undefined {
  return BY_ID.get(section);
}

export function stepIndex(section: ProductSection): number {
  return PRODUCT_WIZARD_STEPS.findIndex((step) => step.id === section);
}

export function nextStep(section: ProductSection): WizardStep | undefined {
  const index = stepIndex(section);
  return index === -1 ? undefined : PRODUCT_WIZARD_STEPS[index + 1];
}

export function previousStep(section: ProductSection): WizardStep | undefined {
  const index = stepIndex(section);
  return index <= 0 ? undefined : PRODUCT_WIZARD_STEPS[index - 1];
}

/**
 * Where a wizard lives — vendor ticket 04.
 *
 * The same eleven steps serve two surfaces: staff at `/admin/products/[id]` and a
 * vendor at `/dashboard/selling/products/[id]`. One base path constant per surface
 * rather than a copy of the step table, because the steps are a property of the
 * *product model* and the product model is the same one.
 *
 * Both folder sets must physically exist — `typedRoutes` checks the shape when the
 * page importing `stepHref` is built, which is the point.
 */
export const WIZARD_BASE = {
  admin: "/admin/products",
  vendor: "/dashboard/selling/products",
} as const;

export type WizardSurface = keyof typeof WIZARD_BASE;

/**
 * The URL for a step.
 *
 * Cast because the id is interpolated at runtime and `typedRoutes` cannot see
 * through that. The *shape* is still checked — a section whose folder does not
 * exist fails when the page importing it is built.
 */
export function stepHref(
  productId: string,
  section: ProductSection,
  surface: WizardSurface = "admin",
): Route {
  const step = BY_ID.get(section) ?? PRODUCT_WIZARD_STEPS[0]!;
  return `${WIZARD_BASE[surface]}/${productId}/${step.segment}` as Route;
}

/**
 * The steps a **vendor** may reach.
 *
 * Every step except `review`'s publishing half — a vendor moves a product to
 * `submitted` and a staff reviewer publishes it (vendor ticket 05). The step list
 * itself is unchanged because the product model is: what differs is who may take
 * the last transition, which is a rule in the service rather than a missing screen.
 *
 * Licence *terms* stay platform defaults (decision V10); the vendor chooses which
 * packages to offer, which is what the pricing step already does.
 */
export const VENDOR_WIZARD_STEPS = PRODUCT_WIZARD_STEPS;

/** For the Stepper, which takes `{ id, label }`. */
export const STEPPER_STEPS = PRODUCT_WIZARD_STEPS.map(({ id, label }) => ({ id, label }));
