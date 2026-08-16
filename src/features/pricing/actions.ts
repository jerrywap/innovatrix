"use server";

import { revalidatePath } from "next/cache";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requirePermission } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { DiscountCode, TaxRule } from "@/lib/db/models/commerce";
import { fromDecimal } from "@/lib/money";
import { objectIdSchema } from "@/validators/common";
import { discountFormSchema, taxRuleFormSchema } from "@/validators/pricing";
import { staffActor, writeAuditLog } from "@/services/audit";
import { discountCodes } from "@/repositories/discount-code.repository";
import { taxRules } from "@/repositories/tax-rule.repository";

/**
 * Discount and tax administration — ticket 10, §90.
 *
 * ## Conversion happens once, here
 *
 * `50` becomes `5000` minor units via `fromDecimal`, and `15` becomes `1500`
 * basis points. Both conversions are in this file and nowhere else — a `× 100`
 * scattered through components is how a promotion ships at a hundredth of its
 * value, and the mistake looks fine in every code review.
 *
 * ## Deactivate, never delete
 *
 * A code on a two-year-old order must still resolve when support looks it up,
 * and a tax rule that produced a number on an invoice must still be nameable.
 * Neither action here removes a row.
 */

/* ────────────────────────────────────────────── discounts */

export async function saveDiscountAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return withAction(async () => {
    const staff = await requirePermission("discount.manage");
    const input = parseInput(discountFormSchema, parseNestedFormData(formData));

    await connectToDatabase();

    const clash = await DiscountCode.findOne({ code: input.code }).lean<{ _id: unknown }>();
    if (clash && (!input.id || String(clash._id) !== input.id)) {
      return fail(`${input.code} already exists.`, {
        code: "CONFLICT",
        fieldErrors: { code: ["That code is already in use."] },
      });
    }

    // The one conversion. `fixed` is money, so it goes through `fromDecimal`
    // and respects the currency's exponent; `percentage` is a rate, so it is
    // whole percent → basis points.
    const raw = Number(input.value.replace(/,/g, ""));
    const value =
      input.kind === "fixed" ? fromDecimal(raw, input.currency!).amount : Math.round(raw * 100);

    const minSpend = input.minSpend
      ? fromDecimal(input.minSpend.replace(/,/g, ""), input.currency ?? "GBP")
      : undefined;

    const document = {
      code: input.code,
      ...(input.description ? { description: input.description } : {}),
      kind: input.kind,
      value,
      ...(input.currency ? { currency: input.currency } : {}),
      ...(minSpend
        ? { minSpend: { amount: minSpend.amount, currency: minSpend.currency } }
        : {}),
      categorySlugs: input.categorySlugs,
      ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
      ...(input.perCustomerLimit !== undefined
        ? { perCustomerLimit: input.perCustomerLimit }
        : {}),
      ...(input.startsAt ? { startsAt: new Date(input.startsAt) } : {}),
      ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
    };

    const saved = input.id
      ? await DiscountCode.findOneAndUpdate(
          { _id: toObjectId(input.id) },
          // `usedCount` is deliberately absent — editing a code must never
          // reset how many times it has been claimed.
          { $set: document },
          { returnDocument: "after" },
        ).lean<{ _id: unknown }>()
      : await DiscountCode.create({
          ...document,
          usedCount: 0,
          productIds: [],
          isActive: true,
          createdByUserId: toObjectId(staff.user.id),
        });

    await writeAuditLog({
      action: input.id ? "discount.updated" : "discount.created",
      actor: staffActor(staff.user),
      after: { code: input.code, kind: input.kind, value },
    });

    revalidatePath("/admin/discounts");
    return ok({ id: String((saved as { _id: unknown })._id) });
  });
}

export async function setDiscountActiveAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ isActive: boolean }>> {
  return withAction(async () => {
    const staff = await requirePermission("discount.manage");
    const raw = parseNestedFormData(formData);
    const id = parseInput(objectIdSchema, raw.id);
    const isActive = raw.isActive === "true";

    const updated = await discountCodes.setActive(id, isActive);
    if (!updated) return fail("That code no longer exists.", { code: "NOT_FOUND" });

    await writeAuditLog({
      action: isActive ? "discount.activated" : "discount.deactivated",
      actor: staffActor(staff.user),
      after: { code: updated.code, isActive },
    });

    revalidatePath("/admin/discounts");
    return ok({ isActive });
  });
}

/* ────────────────────────────────────────────── tax */

export async function saveTaxRuleAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return withAction(async () => {
    const staff = await requirePermission("tax.manage");
    const input = parseInput(taxRuleFormSchema, parseNestedFormData(formData));

    await connectToDatabase();

    if (await taxRules.ruleIdExists(input.ruleId, input.id)) {
      return fail(`${input.ruleId} is already in use.`, {
        code: "CONFLICT",
        fieldErrors: {
          ruleId: ["Rule ids are written onto every order and must be unique."],
        },
      });
    }

    // Whole percent → basis points. `20` becomes `2000`.
    const basisPoints = Math.round(Number(input.percent) * 100);

    const document = {
      ruleId: input.ruleId,
      label: input.label,
      country: input.country,
      kind: input.kind,
      basisPoints,
      priority: input.priority,
      updatedByUserId: toObjectId(staff.user.id),
    };

    const saved = input.id
      ? await TaxRule.findOneAndUpdate(
          { _id: toObjectId(input.id) },
          { $set: document },
          { returnDocument: "after" },
        ).lean<{ _id: unknown }>()
      : await TaxRule.create({ ...document, isActive: true });

    await writeAuditLog({
      action: input.id ? "tax_rule.updated" : "tax_rule.created",
      actor: staffActor(staff.user),
      after: { ruleId: input.ruleId, country: input.country, basisPoints },
      // Worth stating in the log: changing a rate does **not** change any order
      // that already snapshotted it (§61).
      ...(input.id ? { before: { note: "Existing orders keep their snapshot." } } : {}),
    });

    revalidatePath("/admin/settings/tax");
    return ok({ id: String((saved as { _id: unknown })._id) });
  });
}

export async function setTaxRuleActiveAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ isActive: boolean }>> {
  return withAction(async () => {
    const staff = await requirePermission("tax.manage");
    const raw = parseNestedFormData(formData);
    const id = parseInput(objectIdSchema, raw.id);
    const isActive = raw.isActive === "true";

    await connectToDatabase();
    const updated = await TaxRule.findOneAndUpdate(
      { _id: toObjectId(id) },
      { $set: { isActive } },
      { returnDocument: "after" },
    ).lean<{ ruleId: string }>();

    if (!updated) return fail("That rule no longer exists.", { code: "NOT_FOUND" });

    await writeAuditLog({
      action: isActive ? "tax_rule.activated" : "tax_rule.deactivated",
      actor: staffActor(staff.user),
      after: { ruleId: updated.ruleId, isActive },
    });

    revalidatePath("/admin/settings/tax");
    return ok({ isActive });
  });
}
