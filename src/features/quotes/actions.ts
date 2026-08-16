"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requireOrg, requireStaff } from "@/lib/auth/dal";
import { PAYMENT_TERMS, QUOTE_ITEM_KINDS } from "@/lib/db/enums";
import { CURRENCY_CODES, fromDecimal } from "@/lib/money";
import { objectIdSchema } from "@/validators/common";
import * as quotes from "@/services/quotes/quote-service";

/**
 * Quote actions — §51.
 *
 * ## Amounts arrive in major units and convert through `fromDecimal`
 *
 * Never `× 100`. `fromDecimal` throws on a malformed amount rather than
 * producing a plausible wrong number, and it respects the currency's own
 * exponent — the same rule the manual-payment path follows, and for the same
 * reason: this figure becomes a contract.
 */

const itemSchema = z.object({
  kind: z.enum(QUOTE_ITEM_KINDS),
  description: z.string().trim().min(1, "Describe the line").max(300),
  quantity: z.coerce.number().int().min(1).max(9999),
  /** Major units, as typed. */
  unitPrice: z.string().trim().min(1, "Give it a price"),
});

const draftSchema = z.object({
  requestId: objectIdSchema,
  reference: z.string().trim().min(1).max(40),
  organizationId: objectIdSchema,
  title: z.string().trim().min(3, "Give the quote a title").max(200),
  scope: z.string().trim().max(4000).optional(),
  deliverables: z.string().trim().max(4000).optional(),
  exclusions: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(4000).optional(),
  /*
   * Narrowed to the currencies `money.ts` knows the exponent for. A free
   * three-letter string would type-check and then produce the wrong minor
   * units for anything with a non-2 exponent — JPY being the case that always
   * catches this out.
   */
  currency: z.enum(CURRENCY_CODES),
  items: z.array(itemSchema).min(1, "A quote needs at least one line"),
  discount: z.string().trim().optional(),
  taxBasisPoints: z.coerce.number().int().min(0).max(10_000).optional(),
  paymentTerms: z.enum(PAYMENT_TERMS),
  depositPercent: z.coerce.number().int().min(1).max(99).optional(),
  estimatedStart: z.string().trim().optional(),
  estimatedDurationDays: z.coerce.number().int().min(1).max(3650).optional(),
  expiresAt: z.string().trim().min(1, "Pick an expiry date"),
});

/** One line per entry, blanks dropped — §51 wants these as lists, not prose. */
function lines(value?: string): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export async function saveQuoteDraftAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<never>> {
  let reference: string | undefined;

  const result = await withAction<never>(async () => {
    const staff = await requireStaff();
    const input = parseInput(draftSchema, parseNestedFormData(formData));

    let money;
    try {
      money = {
        items: input.items.map((item) => ({
          kind: item.kind,
          description: item.description,
          quantity: item.quantity,
          unitPriceAmount: fromDecimal(item.unitPrice.replace(/,/g, ""), input.currency).amount,
        })),
        discount: input.discount
          ? fromDecimal(input.discount.replace(/,/g, ""), input.currency).amount
          : undefined,
      };
    } catch {
      return fail("One of those amounts isn't a number we can price.", {
        code: "VALIDATION",
        fieldErrors: { items: ["Enter amounts like 8000 or 8000.00."] },
      });
    }

    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return fail("That expiry date doesn't look right.", {
        fieldErrors: { expiresAt: ["Use a real date."] },
      });
    }

    const draft = await quotes.createDraft(
      {
        requestId: input.requestId,
        organizationId: input.organizationId,
        title: input.title,
        ...(input.scope ? { scope: input.scope } : {}),
        deliverables: lines(input.deliverables),
        exclusions: lines(input.exclusions),
        ...(input.notes ? { notes: input.notes } : {}),
        currency: input.currency,
        items: money.items,
        ...(money.discount ? { discountAmount: money.discount } : {}),
        ...(input.taxBasisPoints ? { taxBasisPoints: input.taxBasisPoints } : {}),
        paymentTerms: input.paymentTerms,
        // Percent in the form, basis points in the model — one conversion, here.
        ...(input.depositPercent ? { depositBasisPoints: input.depositPercent * 100 } : {}),
        ...(input.estimatedStart && !Number.isNaN(new Date(input.estimatedStart).getTime())
          ? { estimatedStart: new Date(input.estimatedStart) }
          : {}),
        ...(input.estimatedDurationDays
          ? { estimatedDurationDays: input.estimatedDurationDays }
          : {}),
        expiresAt,
      },
      { userId: staff.user.id, ...(staff.user.name ? { name: staff.user.name } : {}) },
    );

    reference = input.reference;
    revalidatePath(`/staff/requests/${input.reference}`);
    void draft;
    return ok(undefined as never);
  });

  if (!result.ok) return result;
  redirect(`/staff/requests/${reference}` as Route);
}

export async function issueQuoteAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ issued: true }>> {
  return withAction(async () => {
    const staff = await requireStaff();
    const input = parseInput(
      z.object({
        quoteId: objectIdSchema,
        reference: z.string().trim().min(1).max(40),
      }),
      Object.fromEntries(formData.entries()),
    );

    await quotes.issue(input.quoteId, {
      userId: staff.user.id,
      ...(staff.user.name ? { name: staff.user.name } : {}),
      permissions: staff.permissions,
    });

    revalidatePath(`/staff/requests/${input.reference}`);
    revalidatePath("/dashboard/quotes");
    revalidatePath("/dashboard");
    return ok({ issued: true as const });
  });
}

/**
 * The customer's answer — §51.
 *
 * The IP is read here, from `headers()`, and passed in. Services never reach
 * for request context; but acceptance is a contract event, so the request
 * context is exactly what has to be recorded.
 */
export async function answerQuoteAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ answer: "accepted" | "rejected" }>> {
  return withAction(async () => {
    const { user, organizationId } = await requireOrg();

    const input = parseInput(
      z.object({
        quoteId: objectIdSchema,
        answer: z.enum(["accepted", "rejected"]),
        reason: z.string().trim().max(1000).optional(),
      }),
      Object.fromEntries(formData.entries()),
    );

    const requestHeaders = await headers();
    const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();

    const actor = {
      userId: user.id,
      organizationId,
      ...(user.name ? { name: user.name } : {}),
      ...(ip ? { ip } : {}),
    };

    if (input.answer === "accepted") {
      await quotes.accept(input.quoteId, actor);
    } else {
      await quotes.reject(input.quoteId, actor, input.reason);
    }

    revalidatePath("/dashboard/quotes");
    revalidatePath("/dashboard");
    return ok({ answer: input.answer });
  });
}
