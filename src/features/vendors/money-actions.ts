"use server";

import { revalidatePath } from "next/cache";
import { fail, formDataToObject, ok, parseInput, withAction } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/dal";
import { fromDecimal } from "@/lib/money";
import { staffActor } from "@/services/audit";
import {
  setPlatformCommission,
  setVendorCommission,
} from "@/services/vendors/commission-service";
import { recordAdjustment } from "@/services/vendors/ledger-service";
import {
  ledgerAdjustmentSchema,
  platformCommissionSchema,
  vendorCommissionSchema,
} from "./schemas";

/**
 * Vendor money — commission rates and ledger adjustments (vendor tickets 07–08).
 *
 * A separate file from `actions.ts` because the permissions are different in kind, not
 * degree: everything there decides *whether somebody may sell*, and everything here moves
 * or re-prices *money*. `marketplace_manager` holds the first set, `finance` holds the
 * second, and the split is visible in the imports rather than only in a table.
 *
 * Thin, like every other action module: guard, parse, service, invalidate. Each export
 * re-checks its own permission — a form that isn't drawn is not a check, and
 * `action-guards.test.ts` walks this file.
 */

function refreshVendor(vendorId: string) {
  revalidatePath(`/staff/vendor-applications/${vendorId}`);
  // The vendor's own earnings screen shows the rate and the entries, so both change.
  revalidatePath("/dashboard/selling/earnings");
}

/**
 * The platform-wide default rate.
 *
 * Future orders only, and the screen says so — every order stores the rate it was charged
 * at, which is what makes that a fact rather than a promise.
 */
export async function setPlatformCommissionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.manage_commission");
    const input = parseInput(platformCommissionSchema, formDataToObject(formData));

    // Percentage in, basis points out. `× 100` on a value bounded to two decimal places
    // is exact; the rounding is there for the float representation of e.g. 12.35, not for
    // the arithmetic.
    await setPlatformCommission(Math.round(input.percent * 100), staffActor(staff.user));

    revalidatePath("/admin/settings/payments");
    return ok({ saved: true as const });
  });
}

/** One vendor's override. An empty field clears it back to the platform rate. */
export async function setVendorCommissionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.manage_commission");
    const input = parseInput(vendorCommissionSchema, formDataToObject(formData));

    await setVendorCommission(
      input.vendorId,
      input.percent === null ? null : Math.round(input.percent * 100),
      staffActor(staff.user),
    );

    refreshVendor(input.vendorId);
    return ok({ saved: true as const });
  });
}

/**
 * A manual ledger entry.
 *
 * `vendor.adjust_ledger`, which only `finance` and `super_admin` hold: this creates or
 * destroys money on the platform's own authority, and it is the one action here that
 * changes a balance without a sale behind it.
 *
 * `fromDecimal`, never `× 100` — it throws a `MoneyError` on a malformed amount rather
 * than silently producing a wrong integer, and it is the rule §84 sets for every amount
 * that arrives as text.
 */
export async function recordAdjustmentAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ recorded: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.adjust_ledger");
    const input = parseInput(ledgerAdjustmentSchema, formDataToObject(formData));

    try {
      await recordAdjustment(
        {
          vendorId: input.vendorId,
          amount: fromDecimal(input.amount, input.currency),
          note: input.note,
        },
        staffActor(staff.user),
      );
    } catch (error) {
      // A currency `money.ts` refuses, or an amount with more minor units than the
      // currency has. Both are the person's mistake and both deserve the field.
      if (error instanceof Error && error.name === "MoneyError") {
        return fail(error.message, { fieldErrors: { amount: [error.message] } });
      }
      throw error;
    }

    refreshVendor(input.vendorId);
    return ok({ recorded: true as const });
  });
}
