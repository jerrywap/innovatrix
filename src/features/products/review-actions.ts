"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requirePermission } from "@/lib/auth/dal";
import { REVIEW_REASON_CODES } from "@/lib/db/enums";
import { objectIdSchema } from "@/validators/common";
import { staffActor } from "@/services/audit";
import { catalogChanged } from "@/services/catalog/cache";
import * as reviewService from "@/services/catalog/review-service";

/**
 * Deciding a submission — vendor ticket 05.
 *
 * Its own file rather than more of `products/actions.ts`, because the audience is
 * different in a way that matters: everything here writes something a **vendor** will
 * read, and one of the fields must never reach them. Keeping that in one place with
 * the rule stated once is worth a file.
 *
 * Gated on `product.review`, which is new and deliberately not `product.publish`:
 * reading somebody else's submission and sending it back is review work, and putting
 * a finished product on sale is a commercial call.
 */

const decisionSchema = z.object({
  productId: objectIdSchema,
  reasons: z
    .union([z.array(z.enum(REVIEW_REASON_CODES)), z.enum(REVIEW_REASON_CODES)])
    .optional(),
  detail: z.string().trim().max(4000).default(""),
  /**
   * §37 — staff only, and the service stores it where no vendor-facing loader reads
   * it. Accepted here; never echoed back to a vendor anywhere.
   */
  internalNote: z.string().trim().max(4000).optional(),
});

/** A single checkbox posts a string; several post an array. Normalise both. */
function reasonList(value: z.infer<typeof decisionSchema>["reasons"]) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function refresh(productId: string) {
  revalidatePath("/staff/vendor-submissions");
  revalidatePath(`/staff/vendor-submissions/${productId}`);
  revalidatePath(`/admin/products/${productId}`, "layout");
  // The vendor's own view of the same product.
  revalidatePath(`/dashboard/selling/products/${productId}`, "layout");
  revalidatePath("/dashboard/selling/products");
}

/** Claim a submission. Reading something is not feedback, so there is no note. */
export async function claimSubmissionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ claimed: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.review");
    const { productId } = parseInput(
      z.object({ productId: objectIdSchema }),
      parseNestedFormData(formData),
    );

    await reviewService.claim(productId, staffActor(staff.user));

    refresh(productId);
    revalidatePath("/staff");

    return ok({ claimed: true as const });
  });
}

/**
 * Send it back.
 *
 * The reason is required, and it is required in three places for three different
 * reasons: the Zod schema so the form says so, `PRODUCT_TRANSITION_RULES` so the
 * transition refuses without it, and `requestChanges` so a second caller cannot skip
 * either. The vendor reads it verbatim, which is the whole point of insisting.
 */
export async function requestChangesAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ sentBack: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.review");
    const input = parseInput(decisionSchema, parseNestedFormData(formData));

    await reviewService.requestChanges(
      {
        productId: input.productId,
        reasons: reasonList(input.reasons),
        detail: input.detail,
        ...(input.internalNote ? { internalNote: input.internalNote } : {}),
      },
      { ...staffActor(staff.user), userId: staff.user.id },
    );

    catalogChanged();
    refresh(input.productId);
    revalidatePath("/staff");

    return ok({ sentBack: true as const });
  });
}

/**
 * Approve the submission into the platform's own pipeline.
 *
 * Not "publish". `submitted → internal_review` is where this lands, and from there the
 * product takes exactly the path a first-party one takes — same testing checklist,
 * same readiness gate, same `product.publish` at the end. The notification says so
 * too: telling a vendor "it's live" when it has a week of testing ahead is how they
 * stop believing us.
 */
export async function approveSubmissionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ approved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.review");
    const input = parseInput(decisionSchema, parseNestedFormData(formData));

    await reviewService.approve(
      {
        productId: input.productId,
        detail: input.detail,
        reasons: reasonList(input.reasons),
        ...(input.internalNote ? { internalNote: input.internalNote } : {}),
      },
      { ...staffActor(staff.user), userId: staff.user.id },
    );

    catalogChanged();
    refresh(input.productId);
    revalidatePath("/staff");

    return ok({ approved: true as const });
  });
}
