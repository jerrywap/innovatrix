"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formDataToObject, ok, parseInput, withAction } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import { staffActor } from "@/services/audit";
import { catalogChanged, vendorChanged } from "@/services/catalog/cache";
import * as lifecycle from "@/services/vendors/lifecycle-service";

/**
 * Vendor lifecycle actions — vendor ticket 12.
 *
 * Three permissions, and the split is the safeguard rather than bureaucracy:
 *
 * - **`vendor.suspend`** — stops new sales, reversibly. `marketplace_manager` holds it, because
 *   a vendor shipping something harmful cannot wait for a finance sign-off.
 * - **`vendor.offboard`** — ends the relationship. `super_admin` only, deliberately: it happens
 *   with money still owed, and it is the one lifecycle action that is not reversible.
 * - **`product.publish`** — the emergency delisting. Pulling one product from sale is the
 *   publish capability used in the other direction, so it needs no fourth permission.
 *
 * Every one takes a reason, and every one is audited with it. A suspension nobody can explain a
 * month later is a suspension that gets quietly reversed.
 */

const vendorReasonSchema = z.object({
  vendorId: objectIdSchema,
  reason: z.string().trim().min(1, "Say why — the vendor reads this.").max(1000),
});

const vendorIdSchema = z.object({ vendorId: objectIdSchema });

const delistSchema = z.object({
  productId: objectIdSchema,
  reason: z.string().trim().min(1, "What was found, and how?").max(1000),
});

/**
 * The cached reads a lifecycle change invalidates.
 *
 * Here rather than in the service, because `revalidateTag` needs a Next request context and
 * throws outside one — a service that invalidated could not be called from a job, a script or a
 * test. The service returns the slugs it touched precisely so this can be right.
 *
 * The catalogue **and** each product page **and** the storefront: a suspension that took a cache
 * window to show would be a suspended vendor still taking orders.
 */
function invalidateCaches(vendorSlug: string, productSlugs: readonly string[]) {
  catalogChanged(productSlugs);
  vendorChanged(vendorSlug);
}

function refresh(vendorId?: string) {
  revalidatePath("/staff/vendor-applications");
  if (vendorId) revalidatePath(`/staff/vendor-applications/${vendorId}`);
  revalidatePath("/admin/products");
  // The vendor's own workspace changes shape: a suspended vendor's dashboard leads with it.
  revalidatePath("/dashboard/selling", "layout");
}

/**
 * Stop new sales, keep every customer whole.
 *
 * The products are unlisted rather than unpublished, so reinstating is one action — see
 * `lifecycle-service` for why that distinction is load-bearing.
 */
export async function suspendVendorAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ suspended: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.suspend");
    const input = parseInput(vendorReasonSchema, formDataToObject(formData));

    const { vendor, productSlugs } = await lifecycle.suspend(
      input.vendorId,
      input.reason,
      staffActor(staff.user),
    );

    invalidateCaches(vendor.slug, productSlugs);
    refresh(input.vendorId);
    return ok({ suspended: true as const });
  });
}

export async function reinstateVendorAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ reinstated: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.suspend");
    const input = parseInput(vendorIdSchema, formDataToObject(formData));

    const { vendor, productSlugs } = await lifecycle.reinstate(
      input.vendorId,
      staffActor(staff.user),
    );

    invalidateCaches(vendor.slug, productSlugs);
    refresh(input.vendorId);
    return ok({ reinstated: true as const });
  });
}

/**
 * End the relationship.
 *
 * `vendor.offboard`, which only `super_admin` holds. Returns the outstanding balance so the
 * screen can say what still has to be settled — the service deliberately does not refuse when
 * money is owed, because a vendor we cannot offboard over £4 is a vendor still selling.
 */
export async function offboardVendorAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<
  ActionResult<{ outstanding: Array<{ currency: string; amount: number }>; preserved: number }>
> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.offboard");
    const input = parseInput(vendorReasonSchema, formDataToObject(formData));

    const outcome = await lifecycle.offboard(
      input.vendorId,
      input.reason,
      staffActor(staff.user),
    );

    invalidateCaches(outcome.vendor.slug, outcome.productSlugs);
    refresh(input.vendorId);
    return ok({
      outstanding: outcome.outstanding,
      preserved: outcome.entitlementsPreserved,
    });
  });
}

/**
 * Pull one product from sale, now.
 *
 * Entitlements are **suspended, not revoked** — the service's decision, and the same position
 * `processPaymentRefunded` takes: somebody who paid for something later found to be stolen is
 * owed a refund conversation rather than a silent lockout.
 */
export async function emergencyDelistAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ suspended: number }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.publish");
    const input = parseInput(delistSchema, formDataToObject(formData));

    const outcome = await lifecycle.emergencyDelist(
      input.productId,
      input.reason,
      staffActor(staff.user),
    );

    catalogChanged([outcome.productSlug]);
    if (outcome.vendorSlug) vendorChanged(outcome.vendorSlug);
    refresh();
    return ok({ suspended: outcome.entitlementsSuspended });
  });
}
