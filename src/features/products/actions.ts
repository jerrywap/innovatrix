"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requirePermission } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import {
  productBasicsSchema,
  productClassificationSchema,
  productContentSchema,
  productMediaSchema,
  productOptionsSchema,
  productPricingSchema,
  productDemoSchema,
  productSeoSchema,
  productSlugSchema,
  productTestingSchema,
} from "@/validators/product-sections";
import { richTextDocumentSchema, type RichTextDocument } from "@/lib/rich-text/schema";
import { PRODUCT_STATUSES, type ProductStatus } from "@/lib/db/enums";
import { descriptionFields } from "@/lib/db/models/catalog";
import { staffActor } from "@/services/audit";
import { catalogChanged } from "@/services/catalog/cache";
import * as demoService from "@/services/catalog/demo-service";
import * as productService from "@/services/catalog/product-service";
import * as testingService from "@/services/catalog/testing-service";
import { z } from "zod";

/**
 * Product admin actions — §41–46.
 *
 * Deliberately thin. Each one does the same five things and nothing else:
 * check the permission, parse the input, call a service, invalidate the cache,
 * return. No `if` about domain state lives here — that is all in
 * `services/catalog/`, which is inside vitest's coverage floor while
 * `src/features/**` is not.
 *
 * Every action re-checks its permission. A server action is a public POST
 * endpoint: the wizard hiding a step is not a permission check, and the step's
 * page guard does not protect the action behind it.
 */

/* ────────────────────────────────────────────── helpers */

/** The bit of request context services must not reach for themselves. */
async function requestContext() {
  const heads = await headers();
  return {
    ...(heads.get("x-forwarded-for")
      ? { ip: heads.get("x-forwarded-for")!.split(",")[0]!.trim() }
      : {}),
    ...(heads.get("user-agent") ? { userAgent: heads.get("user-agent")! } : {}),
  };
}

/**
 * "Save" versus "Save and continue".
 *
 * The `next` path is only honoured when it is one of *our* admin paths — it
 * arrives in the form body, so treating it as trusted would be an open
 * redirect with extra steps.
 */
function continueTo(raw: Record<string, unknown>): Route | undefined {
  if (raw.intent !== "continue") return undefined;

  const next = typeof raw.next === "string" ? raw.next : "";
  return next.startsWith("/admin/") && !next.startsWith("//") ? (next as Route) : undefined;
}

const productIdSchema = z.object({ productId: objectIdSchema });

/** Re-render the wizard so the Stepper's ticks and the readiness rail update. */
function refreshWizard(productId: string) {
  revalidatePath(`/admin/products/${productId}`, "layout");
  revalidatePath("/admin/products");
}

/* ────────────────────────────────────────────── create */

export async function createProductAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  let createdId: string | undefined;

  const result = await withAction<never>(async () => {
    // `product.create`, not `product.update` — §77 gives `content_manager` the
    // second without the first, and that distinction is the point.
    const staff = await requirePermission("product.create");

    const raw = parseNestedFormData(formData);
    const input = parseInput(productBasicsSchema, {
      ...raw,
      description: parseDescription(raw.description),
    });

    const product = await productService.createDraft(input, staffActor(staff.user));
    createdId = String(product._id);
    catalogChanged();

    return ok(undefined as never);
  });

  if (!result.ok) return result;
  // Straight into the wizard at the next step — the draft exists now, so
  // there is nothing to lose by navigating.
  redirect(`/admin/products/${createdId}/classification` as Route);
}

/* ────────────────────────────────────────────── section saves */

/**
 * One save action per section, built from the same three ingredients.
 *
 * A factory rather than ten near-identical functions, so the guard, the parse
 * and the invalidation cannot drift apart between steps — which is exactly how
 * one step ends up saving without checking a permission.
 */
function sectionAction<S extends z.ZodType>(config: {
  section: string;
  permission: Parameters<typeof requirePermission>[0];
  schema: S;
  toUpdate: (input: z.infer<S>) => Record<string, unknown>;
}) {
  return async function saveSectionAction(
    _previous: ActionResult<unknown> | null,
    formData: FormData,
  ): Promise<ActionResult<{ saved: true }>> {
    let target: Route | undefined;

    const result = await withAction<{ saved: true }>(async () => {
      const staff = await requirePermission(config.permission);

      const raw = parseNestedFormData(formData);
      const { productId } = parseInput(productIdSchema, raw);
      const input = parseInput(config.schema, raw);

      await productService.saveSection(
        productId,
        config.section,
        config.toUpdate(input),
        staffActor(staff.user),
      );

      catalogChanged();
      refreshWizard(productId);
      target = continueTo(raw);

      return ok({ saved: true as const });
    });

    if (result.ok && target) redirect(target);
    return result;
  };
}

export const saveBasicsAction = sectionAction({
  section: "basics",
  permission: "product.update",
  schema: productBasicsSchema,
  toUpdate: (input) => ({
    name: input.name,
    summary: input.summary,
    // Both description fields, or neither — see `descriptionFields`.
    ...descriptionFields(input.description),
  }),
});

export const saveContentAction = sectionAction({
  section: "content",
  permission: "product.update",
  schema: productContentSchema,
  toUpdate: (input) => ({
    features: input.features,
    requirements: input.requirements,
  }),
});

export const saveMediaAction = sectionAction({
  section: "media",
  permission: "product.update",
  schema: productMediaSchema,
  toUpdate: (input) => ({ media: input.media }),
});

export const savePricingAction = sectionAction({
  section: "pricing",
  // §77 gives this to `sales` and `finance` and withholds it from
  // `content_manager`, who can edit copy but not what anything costs.
  permission: "product.manage_pricing",
  schema: productPricingSchema,
  toUpdate: (input) => ({
    prices: input.prices,
    licencePackages: input.licencePackages,
    addons: input.addons,
  }),
});

export const saveOptionsAction = sectionAction({
  section: "options",
  permission: "product.update",
  schema: productOptionsSchema,
  toUpdate: (input) => ({
    installation: input.installation,
    "customization.available": input.customization.available,
    "customization.aiWorkflowEnabled": input.customization.aiWorkflowEnabled,
    "customization.technicalReviewRequired": input.customization.technicalReviewRequired,
    "customization.typicalTurnaround": input.customization.typicalTurnaround,
    "customization.suggestedAreas": input.customization.suggestedAreas,
  }),
});

export const saveSeoAction = sectionAction({
  section: "seo",
  permission: "product.update",
  schema: productSeoSchema,
  toUpdate: (input) => ({ seo: input.seo }),
});

/**
 * Classification is not built from the factory.
 *
 * It is the one section whose save must also re-derive `products.facets` —
 * miss that and the product keeps appearing under its old category and stops
 * appearing under its new one, with nothing anywhere reporting a problem.
 */
export async function saveClassificationAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  let target: Route | undefined;

  const result = await withAction<{ saved: true }>(async () => {
    const staff = await requirePermission("product.update");

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const input = parseInput(productClassificationSchema, raw);

    await productService.saveClassification(
      productId,
      {
        categoryIds: input.categoryIds,
        industryIds: input.industryIds,
        technologyIds: input.technologyIds,
        ...(input.productTypeId ? { productTypeId: input.productTypeId } : {}),
      },
      staffActor(staff.user),
    );

    catalogChanged();
    refreshWizard(productId);
    target = continueTo(raw);

    return ok({ saved: true as const });
  });

  if (result.ok && target) redirect(target);
  return result;
}

/* ────────────────────────────────────────────── slug */

export async function changeSlugAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ slug: string }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.update");

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const { slug } = parseInput(productSlugSchema, raw);

    const before = await productService
      .changeSlug(productId, slug, staffActor(staff.user))
      .catch((error: unknown) => {
        throw error;
      });

    // Both the new slug and every retired one — the old URL must stop serving
    // the cached page and start serving the redirect.
    catalogChanged([before.slug, ...before.slugHistory]);
    refreshWizard(productId);

    return ok({ slug: before.slug });
  });
}

/* ────────────────────────────────────────────── lifecycle */

const transitionSchema = z.object({
  productId: objectIdSchema,
  to: z.enum(PRODUCT_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export async function transitionProductAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ status: ProductStatus }>> {
  return withAction(async () => {
    const raw = parseNestedFormData(formData);
    const input = parseInput(transitionSchema, raw);

    // Publishing and unpublishing are their own permissions — `product.update`
    // is not enough to put something in front of customers.
    const permission =
      input.to === "published"
        ? "product.publish"
        : input.to === "deprecated" || input.to === "archived"
          ? "product.unpublish"
          : "product.update";

    const staff = await requirePermission(permission);

    const product = await productService.transition(
      input.productId,
      input.to,
      staffActor(staff.user),
      { ...(input.reason ? { reason: input.reason } : {}), ...(await requestContext()) },
    );

    catalogChanged([product.slug]);
    refreshWizard(input.productId);

    return ok({ status: product.status });
  });
}

const bulkSchema = z.object({
  productIds: z
    .union([objectIdSchema, z.array(objectIdSchema)])
    .transform((v) => (Array.isArray(v) ? v : [v])),
  to: z.enum(PRODUCT_STATUSES),
});

/**
 * Publish or unpublish a selection.
 *
 * Reports per product rather than failing whole: a selection of twelve where
 * one lacks a screenshot should move eleven and say why the twelfth did not.
 * A batch that fails entirely makes the administrator find the culprit by
 * bisection.
 */
export async function bulkTransitionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<
  ActionResult<{
    changed: number;
    skipped: Array<{ id: string; reason: string }>;
    failed: Array<{ id: string; reason: string }>;
  }>
> {
  return withAction(async () => {
    const raw = parseNestedFormData(formData);
    const input = parseInput(bulkSchema, raw);

    const permission =
      input.to === "published"
        ? "product.publish"
        : input.to === "deprecated" || input.to === "archived"
          ? "product.unpublish"
          : "product.update";

    const staff = await requirePermission(permission);

    const outcome = await productService.bulkTransition(
      input.productIds,
      input.to,
      staffActor(staff.user),
    );

    catalogChanged();
    revalidatePath("/admin/products");

    return ok({
      changed: outcome.changed.length,
      skipped: outcome.skipped,
      failed: outcome.failed,
    });
  });
}

/* ────────────────────────────────────────────── delete */

export async function deleteProductAction(productId: string): Promise<ActionResult<void>> {
  const result = await withAction<void>(async () => {
    const staff = await requirePermission("product.delete");
    parseInput(objectIdSchema, productId);

    await productService.softDelete(productId, staffActor(staff.user));

    catalogChanged();
    revalidatePath("/admin/products");

    return ok(undefined);
  });

  if (!result.ok) return result;
  redirect("/admin/products");
}

/* ────────────────────────────────────────────── input helpers */

/**
 * The description arrives as a JSON string from the editor's hidden field.
 *
 * Parsed here and validated by `productBasicsSchema`, which is where the
 * allowlist lives. A malformed string becomes `undefined` rather than throwing,
 * so a corrupted field reads as "no description" — a validation error naming
 * the field — instead of a 500 the author cannot act on.
 */
function parseDescription(value: unknown): RichTextDocument | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;

  try {
    // Returns the *parsed* value, not the input: Zod strips unknown keys, so
    // this is what makes the schema a filter rather than only a check.
    const result = richTextDocumentSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export async function saveDescriptionOnlyAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.update");

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const description = parseDescription(raw.description);

    if (description === undefined) {
      return fail("That description couldn't be read. Try again.", {
        code: "VALIDATION",
        fieldErrors: { description: ["The editor sent something unreadable."] },
      });
    }

    await productService.saveSection(
      productId,
      "basics",
      descriptionFields(description),
      staffActor(staff.user),
    );

    catalogChanged();
    refreshWizard(productId);

    return ok({ saved: true as const });
  });
}

/* ────────────────────────────────────────────── demo & testing (ticket 07) */

/**
 * Demo configuration — §9.
 *
 * Not built with `sectionAction` on purpose. That factory hands the parsed
 * input straight to `saveSection`, which `$set`s it verbatim — and the parsed
 * input here contains **plaintext passwords**. Routing this through the demo
 * service instead is what guarantees a password is sealed before it can reach
 * Mongo, and the audit row records role names and a count rather than the rows
 * themselves.
 */
export async function saveDemoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  let target: Route | undefined;

  const result = await withAction<{ saved: true }>(async () => {
    const staff = await requirePermission("product.update");

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const { demo } = parseInput(productDemoSchema, raw);

    await demoService.saveDemo(productId, demo, staffActor(staff.user));

    catalogChanged();
    refreshWizard(productId);
    target = continueTo(raw);

    return ok({ saved: true as const });
  });

  if (result.ok && target) redirect(target);
  return result;
}

/** The §47 checklist. `product.update`, because testing is not publishing. */
export async function saveTestingAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  let target: Route | undefined;

  const result = await withAction<{ saved: true }>(async () => {
    const staff = await requirePermission("product.update");

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const { testingChecklist } = parseInput(productTestingSchema, raw);

    await testingService.saveChecklist(productId, testingChecklist, staffActor(staff.user));

    refreshWizard(productId);
    target = continueTo(raw);

    return ok({ saved: true as const });
  });

  if (result.ok && target) redirect(target);
  return result;
}
