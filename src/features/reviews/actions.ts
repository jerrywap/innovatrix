"use server";

import { revalidatePath } from "next/cache";
import { formDataToObject, ok, parseInput, withAction } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import {
  requireOrg,
  requirePermission,
  requireUser,
  requireVendorOrForbid,
} from "@/lib/auth/dal";
import { staffActor, vendorActor } from "@/services/audit";
import { catalogChanged } from "@/services/catalog/cache";
import * as reviews from "@/services/reviews/review-service";
import {
  reviewDismissSchema,
  reviewEditSchema,
  reviewModerateSchema,
  reviewReportSchema,
  reviewSubmitSchema,
  vendorResponseSchema,
} from "./schemas";

/**
 * Review actions — vendor ticket 10.
 *
 * Four different callers, four different guards, and the differences are the feature:
 *
 * | Who | Guard | May |
 * |---|---|---|
 * | customer | `requireOrg()` | write and edit **their own** |
 * | vendor | `requireVendorOrForbid()` | respond, report |
 * | staff | `requirePermission("review.moderate")` | hide, remove, restore |
 * | anybody signed in | `requireUser()` | report |
 *
 * Nobody may edit somebody else's words — there is no action for it and no permission that
 * would open one. Staff hide or remove; a vendor does neither, because a seller who can
 * suppress criticism of their own product makes every remaining review worthless.
 */

/**
 * Invalidate everything a review write changes.
 *
 * `catalogChanged()` is the important one and easy to miss: the product page's rating comes
 * from `getProductDetail`, a `"use cache"` read tagged with the product slug, so a new review
 * would show in the list (loaded outside that cache) while the star row above it still said
 * the old number. Dumping the catalogue tag also fixes the marketplace cards, which carry the
 * same aggregate.
 *
 * The slug is not always to hand — the customer's form carries an entitlement id, not a
 * product — so this invalidates the catalogue tag rather than one product's. A review is not a
 * hot write path, and being right is worth more here than being narrow.
 */
function refreshProduct() {
  catalogChanged();
  revalidatePath("/dashboard/software", "layout");
  revalidatePath("/dashboard/selling/reviews");
  revalidatePath("/staff/reviews");
}

/* ────────────────────────────────────────────── the customer */

/**
 * Leave a review.
 *
 * `requireOrg()` supplies the scope; the entitlement id is the only thing the form carries
 * about *what* is being reviewed, and the service refuses one that is not this
 * organisation's. There is deliberately no `productId` field to disagree with it.
 */
export async function submitReviewAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ reviewId: string }>> {
  return withAction(async () => {
    const { user, organizationId } = await requireOrg();
    const input = parseInput(reviewSubmitSchema, formDataToObject(formData));

    const review = await reviews.submit(
      {
        entitlementId: input.entitlementId,
        rating: input.rating,
        ...(input.title ? { title: input.title } : {}),
        body: input.body,
      },
      { organizationId },
      { type: "customer", userId: user.id, ...(user.name ? { name: user.name } : {}) },
    );

    refreshProduct();
    return ok({ reviewId: String(review._id) });
  });
}

/** Edit your own. The service puts `authorUserId` in the filter, so it can only be yours. */
export async function editReviewAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const user = await requireUser();
    const input = parseInput(reviewEditSchema, formDataToObject(formData));

    await reviews.edit(
      input.reviewId,
      {
        rating: input.rating,
        ...(input.title ? { title: input.title } : {}),
        body: input.body,
      },
      { type: "customer", userId: user.id, ...(user.name ? { name: user.name } : {}) },
    );

    refreshProduct();
    return ok({ saved: true as const });
  });
}

/** "Don't ask me again" — permanent, and scoped so it can only be your own purchase. */
export async function dismissReviewPromptAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ dismissed: true }>> {
  return withAction(async () => {
    const { organizationId } = await requireOrg();
    const input = parseInput(reviewDismissSchema, formDataToObject(formData));

    await reviews.dismissPrompt(input.entitlementId, { organizationId });

    revalidatePath("/dashboard/software", "layout");
    return ok({ dismissed: true as const });
  });
}

/* ────────────────────────────────────────────── the vendor */

/**
 * Reply publicly, once, edit-visible.
 *
 * The vendor scope comes from the session and is in the service's filter, so a vendor cannot
 * reply to a review of somebody else's product — and the refusal is a 404, consistent with
 * the rest of the vendor workspace.
 */
export async function respondToReviewAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    const input = parseInput(vendorResponseSchema, formDataToObject(formData));

    await reviews.respond(input.reviewId, input.body, context.vendorId, {
      ...vendorActor(context.user, context.vendorId),
      userId: context.user.id,
    });

    refreshProduct();
    return ok({ saved: true as const });
  });
}

/**
 * Report a review — as a vendor.
 *
 * A vendor may ask somebody else to look. That is the whole of what they may do, and it is
 * the reason this action exists separately from the moderation one rather than as a mode of it.
 */
export async function reportReviewAsVendorAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ reported: true }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    const input = parseInput(reviewReportSchema, formDataToObject(formData));

    await reviews.report(
      input.reviewId,
      {
        reason: input.reason,
        ...(input.detail ? { detail: input.detail } : {}),
        vendorId: context.vendorId,
      },
      {
        ...vendorActor(context.user, context.vendorId),
        userId: context.user.id,
      },
    );

    refreshProduct();
    return ok({ reported: true as const });
  });
}

/* ────────────────────────────────────────────── anybody, and staff */

/** Report a review as a signed-in customer. */
export async function reportReviewAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ reported: true }>> {
  return withAction(async () => {
    const user = await requireUser();
    const input = parseInput(reviewReportSchema, formDataToObject(formData));

    await reviews.report(
      input.reviewId,
      { reason: input.reason, ...(input.detail ? { detail: input.detail } : {}) },
      { type: "customer", userId: user.id, ...(user.name ? { name: user.name } : {}) },
    );

    refreshProduct();
    return ok({ reported: true as const });
  });
}

/**
 * Hide, remove or restore.
 *
 * The only path that changes a review's visibility, and it is behind `review.moderate` —
 * which no vendor role holds and no vendor session could satisfy, since `requirePermission`
 * needs a staff session.
 */
export async function moderateReviewAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ moderated: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("review.moderate");
    const input = parseInput(reviewModerateSchema, formDataToObject(formData));

    await reviews.moderate(
      input.reviewId,
      input.status,
      input.reason ?? "",
      staffActor(staff.user),
    );

    refreshProduct();
    return ok({ moderated: true as const });
  });
}
