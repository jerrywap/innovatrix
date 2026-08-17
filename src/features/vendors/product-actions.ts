"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { ForbiddenError } from "@/lib/errors";
import { objectIdSchema } from "@/validators/common";
import {
  productBasicsSchema,
  productClassificationSchema,
  productDemoSchema,
  productTestingSchema,
} from "@/validators/product-sections";
import { richTextDocumentSchema, type RichTextDocument } from "@/lib/rich-text/schema";
import { vendorActor } from "@/services/audit";
import { catalogChanged } from "@/services/catalog/cache";
import * as demoService from "@/services/catalog/demo-service";
import * as productService from "@/services/catalog/product-service";
import * as reviewService from "@/services/catalog/review-service";
import * as testingService from "@/services/catalog/testing-service";
import {
  BASICS_SECTION,
  CONTENT_SECTION,
  MEDIA_SECTION,
  OPTIONS_SECTION,
  PRICING_SECTION,
  SEO_SECTION,
  type SectionConfig,
} from "@/features/products/section-config";

/**
 * A vendor authoring their own product — vendor ticket 04.
 *
 * The staff equivalents live in `features/products/actions.ts` and the two share
 * `section-config.ts`, so both surfaces write the same fields of the same document.
 *
 * ## What differs from the staff surface, and only this
 *
 * 1. **The guard.** `requireVendorOrForbid()` rather than `requirePermission()`.
 *    A vendor holds no staff permissions and never will; what authorises them is
 *    *ownership*.
 * 2. **The scope.** Every write carries `{ vendorId }` into the filter, so a
 *    product belonging to somebody else does not match and the service raises
 *    `NotFoundError` — **404, not 403**. Distinguishing them would turn this
 *    workspace into an oracle for which product ids are real, and a vendor product
 *    id is a URL somebody will try.
 * 3. **The actor.** `vendorActor`, so the audit log records who acted *and* in what
 *    capacity. Recorded as `customer` it would be wrong in the one collection that
 *    exists to be trustworthy later.
 * 4. **The paths.** Revalidation and the continue-redirect point at
 *    `/dashboard/selling/products`.
 *
 * Publishing is absent from this file, and that is not the whole of the guarantee —
 * `transition` refuses the edge for a vendor scope too (vendor ticket 05). A
 * missing action is a missing button; the service is what makes it a rule.
 *
 * Every exported function calls `save()` or `requireVendorOrForbid()` in its own
 * body, which is what `action-guards.test.ts` walks. A factory that closed over the
 * guard in another module would pass this file's actions off as guarded without the
 * test being able to see it.
 */

const productIdSchema = z.object({ productId: objectIdSchema });

/**
 * The attestation checkbox.
 *
 * `z.literal("on")` rather than a coerced boolean: an unchecked box sends **nothing**,
 * so a `z.coerce.boolean()` would read `undefined` as `false` and produce a confusing
 * "expected boolean" rather than the sentence a person needs. Required here and
 * re-checked in the service, which is where it is recorded.
 */
const submitSchema = z.object({
  attested: z.literal("on", {
    error: "Confirm the declaration before submitting.",
  }),
});

const BASE = "/dashboard/selling/products";

function refresh(productId: string) {
  revalidatePath(`${BASE}/${productId}`, "layout");
  revalidatePath(BASE);
}

/**
 * "Save" versus "Save and continue".
 *
 * The allowed prefix is this surface's, not `/admin/`. `next` arrives in the form
 * body, so treating it as trusted would be an open redirect with extra steps — and
 * accepting `/admin/` here would send a vendor at a screen they cannot open.
 */
function continueTo(raw: Record<string, unknown>): Route | undefined {
  if (raw.intent !== "continue") return undefined;

  const next = typeof raw.next === "string" ? raw.next : "";
  return next.startsWith(`${BASE}/`) && !next.startsWith("//") ? (next as Route) : undefined;
}

/**
 * The shared body of every section save on this surface.
 *
 * A local helper rather than a factory in another module: `action-guards.test.ts`
 * follows calls to helpers declared in the *same file*, so the guard below counts
 * for every action that calls this — and stops counting the moment somebody moves
 * it out.
 */
async function save<S extends z.ZodType>(
  config: SectionConfig<S>,
  formData: FormData,
): Promise<{ result: ActionResult<{ saved: true }>; target?: Route }> {
  let target: Route | undefined;

  const result = await withAction<{ saved: true }>(async () => {
    const context = await requireVendorOrForbid();

    // A vendor whose account is not verified may not author. The listing gate is
    // identity verification (vendor ticket 02), and the workspace is only reachable
    // once the vendor is `verified` — asserted here as well, because a layout is
    // not a permission check.
    if (context.vendor.status !== "verified") {
      throw new ForbiddenError("Your vendor account is not active.");
    }

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const input = parseInput(config.schema, raw);

    await productService.saveSection(
      productId,
      config.section,
      config.toUpdate(input),
      vendorActor(context.user, context.vendorId),
      { vendorId: context.vendorId },
    );

    catalogChanged();
    refresh(productId);
    target = continueTo(raw);

    return ok({ saved: true as const });
  });

  return target ? { result, target } : { result };
}

/* ────────────────────────────────────────────── section saves */

export async function saveVendorBasicsAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  const { result, target } = await save(BASICS_SECTION, formData);
  if (result.ok && target) redirect(target);
  return result;
}

export async function saveVendorContentAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  const { result, target } = await save(CONTENT_SECTION, formData);
  if (result.ok && target) redirect(target);
  return result;
}

export async function saveVendorMediaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  const { result, target } = await save(MEDIA_SECTION, formData);
  if (result.ok && target) redirect(target);
  return result;
}

export async function saveVendorPricingAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  const { result, target } = await save(PRICING_SECTION, formData);
  if (result.ok && target) redirect(target);
  return result;
}

export async function saveVendorOptionsAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  const { result, target } = await save(OPTIONS_SECTION, formData);
  if (result.ok && target) redirect(target);
  return result;
}

export async function saveVendorSeoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  const { result, target } = await save(SEO_SECTION, formData);
  if (result.ok && target) redirect(target);
  return result;
}

/**
 * Classification is not built from the shared config, for the same reason it is not
 * on the staff surface: its save must also re-derive `products.facets`.
 *
 * Miss that and the product keeps appearing under its old category, stops appearing
 * under its new one, and — the part specific to this surface — loses its `vend:`
 * term and vanishes from its own storefront. Nothing errors.
 * `saveClassification` reads the vendor slug from the document precisely so this
 * cannot be got wrong here.
 */
export async function saveVendorClassificationAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  let target: Route | undefined;

  const result = await withAction<{ saved: true }>(async () => {
    const context = await requireVendorOrForbid();
    if (context.vendor.status !== "verified") {
      throw new ForbiddenError("Your vendor account is not active.");
    }

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const input = parseInput(productClassificationSchema, raw);

    await productService.saveClassification(
      productId,
      { ...input },
      vendorActor(context.user, context.vendorId),
      { vendorId: context.vendorId },
    );

    catalogChanged();
    refresh(productId);
    target = continueTo(raw);

    return ok({ saved: true as const });
  });

  if (result.ok && target) redirect(target);
  return result;
}

/**
 * Demo URLs and test credentials.
 *
 * Not built from the shared config because the parsed input contains **plaintext
 * passwords** and has to go through `demoService.saveDemo`, which seals them with
 * AES-256-GCM bound to the product id. A plain `$set` would put the plaintext in the
 * document and the ciphertext nowhere.
 *
 * A vendor gets this step: the demo is part of their product, and the sealing path
 * is the same one staff use — `AdminProductView` carries no credential field at all,
 * so nothing reaches this surface's RSC payload either.
 */
export async function saveVendorDemoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  let target: Route | undefined;

  const result = await withAction<{ saved: true }>(async () => {
    const context = await requireVendorOrForbid();
    if (context.vendor.status !== "verified") {
      throw new ForbiddenError("Your vendor account is not active.");
    }

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const { demo } = parseInput(productDemoSchema, raw);

    await demoService.saveDemo(productId, demo, vendorActor(context.user, context.vendorId), {
      vendorId: context.vendorId,
    });

    catalogChanged();
    refresh(productId);
    target = continueTo(raw);

    return ok({ saved: true as const });
  });

  if (result.ok && target) redirect(target);
  return result;
}

/**
 * The §47 testing checklist.
 *
 * A vendor fills this in for their own product, and it is the same checklist and
 * the same gate: `computeReadiness()` refuses submission while it is incomplete
 * (vendor ticket 05), exactly as it refuses publication for a first-party one.
 *
 * `checkedByUserId` is only stamped for a `staff` actor, so a vendor's ticks record
 * the time and not a staff attribution — the audit row carries who it really was.
 */
export async function saveVendorTestingAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  let target: Route | undefined;

  const result = await withAction<{ saved: true }>(async () => {
    const context = await requireVendorOrForbid();
    if (context.vendor.status !== "verified") {
      throw new ForbiddenError("Your vendor account is not active.");
    }

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const { testingChecklist } = parseInput(productTestingSchema, raw);

    await testingService.saveChecklist(
      productId,
      testingChecklist,
      vendorActor(context.user, context.vendorId),
      { vendorId: context.vendorId },
    );

    refresh(productId);
    target = continueTo(raw);

    return ok({ saved: true as const });
  });

  if (result.ok && target) redirect(target);
  return result;
}

/* ────────────────────────────────────────────── submission */

/**
 * Hand a product over for review — vendor ticket 05.
 *
 * Everything that decides *whether* this may happen is in the service:
 * `PRODUCT_TRANSITION_RULES` says a vendor may take `draft → submitted`,
 * `computeReadiness()` says the product is complete, and `assertTransition` refuses a
 * second submission while one is open because `submitted` has no edge to itself.
 *
 * The attestation is a checkbox here and a record with a name, a timestamp and a
 * version there. That difference is the whole point: a tick is a claim, and what a
 * takedown needs is a defence.
 */
export async function submitForReviewAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ submitted: true }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    if (context.vendor.status !== "verified") {
      throw new ForbiddenError("Your vendor account is not active.");
    }

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);
    const { attested } = parseInput(submitSchema, raw);

    await reviewService.submit(
      { productId, scope: { vendorId: context.vendorId }, attested: attested === "on" },
      { ...vendorActor(context.user, context.vendorId), userId: context.user.id },
    );

    catalogChanged();
    refresh(productId);
    revalidatePath("/staff/vendor-submissions");

    return ok({ submitted: true as const });
  });
}

/**
 * Withdraw a submission nobody has claimed yet.
 *
 * Only legal from `submitted` — once a reviewer has it, the way back is
 * `changes_requested`, which carries a reason. That is the machine's rule, not this
 * action's: `PRODUCT_TRANSITIONS` has no `internal_review → draft` edge a vendor may
 * take.
 */
export async function withdrawSubmissionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ withdrawn: true }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();

    const raw = parseNestedFormData(formData);
    const { productId } = parseInput(productIdSchema, raw);

    await productService.transition(
      productId,
      "draft",
      vendorActor(context.user, context.vendorId),
      { scope: { vendorId: context.vendorId } },
    );

    catalogChanged();
    refresh(productId);
    revalidatePath("/staff/vendor-submissions");

    return ok({ withdrawn: true as const });
  });
}

/* ────────────────────────────────────────────── create */

/**
 * Create a draft owned by this vendor.
 *
 * Ownership is stamped **here, from the session**, and is not a field on the form.
 * A `vendorId` in a request body is a claim about whose catalogue a product joins.
 */
export async function createVendorProductAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  let createdId: string | undefined;

  const result = await withAction<never>(async () => {
    const context = await requireVendorOrForbid();
    if (context.vendor.status !== "verified") {
      throw new ForbiddenError("Your vendor account is not active.");
    }

    const raw = parseNestedFormData(formData);
    const input = parseInput(productBasicsSchema, {
      ...raw,
      description: parseDescription(raw.description),
    });

    const product = await productService.createDraft(
      {
        ...input,
        vendor: {
          id: context.vendorId,
          slug: context.vendor.slug,
          name: context.vendor.displayName,
        },
      },
      vendorActor(context.user, context.vendorId),
    );

    createdId = String(product._id);
    catalogChanged();

    return ok(undefined as never);
  });

  if (!result.ok) return result;
  redirect(`${BASE}/${createdId}/classification` as Route);
}

/** The rich-text tree arrives as JSON in a hidden field. */
function parseDescription(value: unknown): RichTextDocument | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    return richTextDocumentSchema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}
