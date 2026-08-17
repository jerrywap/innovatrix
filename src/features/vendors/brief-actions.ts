"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requirePermission, requireVendorOrForbid } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import { fromDecimal, type CurrencyCode } from "@/lib/money";
import { staffActor, vendorActor } from "@/services/audit";
import { postMessage } from "@/services/messaging/messaging-service";
import * as briefs from "@/services/vendors/brief-service";

/**
 * Vendor-directed customization — vendor ticket 14.
 *
 * Three callers, and the asymmetry is the ticket:
 *
 * | Who | May |
 * |---|---|
 * | staff | send a request to its vendor, withdraw a brief, post on the brief thread |
 * | vendor (any active member) | reply on the brief thread, price it, decline it |
 * | customer | **nothing here at all** |
 *
 * That last row is the mediation, and it is enforced by absence rather than by a permission:
 * there is no action in this file a customer could reach, and no action that takes a customer id
 * or writes to their thread. A vendor equally has no action that reads one.
 *
 * `member` and `owner` are the same here. Pricing work is what a vendor *does*; the one separation
 * the two-role model exists for is who may change the payout account.
 */

const routeSchema = z.object({
  requestId: objectIdSchema,
  note: z.string().trim().max(4000).optional(),
});

const briefTarget = z.object({ briefId: objectIdSchema });

const proposalSchema = z.object({
  briefId: objectIdSchema,
  /**
   * A **decimal string**, exactly as `MoneyInput` posts one — `2400`, not `240000`.
   *
   * The client never does money arithmetic, and this is the reason: a `× 100` in a component is
   * wrong for JPY, which has no minor unit. `fromDecimal` knows each currency's exponent and is the
   * only thing that converts.
   */
  amount: z.string().trim().min(1, "Give a price for the work."),
  currency: z.string().trim().length(3),
  effort: z.string().trim().min(1, "Say roughly how long it would take.").max(400),
  caveats: z.string().trim().max(4000).optional(),
  validUntil: z.string().trim().max(40).optional(),
});

const declineSchema = z.object({
  briefId: objectIdSchema,
  reason: z
    .string()
    .trim()
    .min(1, "Say why — we have to tell the customer something.")
    .max(2000),
});

const replySchema = z.object({
  briefId: objectIdSchema,
  body: z.string().trim().min(1, "Write something first.").max(5000),
});

function refreshVendor(briefId: string) {
  revalidatePath("/dashboard/selling/requests");
  revalidatePath(`/dashboard/selling/requests/${briefId}`);
  revalidatePath("/dashboard/selling");
}

/* ────────────────────────────────────────────── staff */

/** Hand a request to its vendor — the triage gate (decision W3). */
export async function routeToVendorAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ briefId: string }>> {
  return withAction(async () => {
    const staff = await requirePermission("request.update_status");
    const input = parseInput(routeSchema, parseNestedFormData(formData));

    const brief = await briefs.routeToVendor(input, {
      ...staffActor(staff.user),
      userId: staff.user.id,
    });

    revalidatePath(`/staff/requests`, "layout");
    refreshVendor(String(brief._id));

    return ok({ briefId: String(brief._id) });
  });
}

/** Pull a brief back — also what a requirements revision calls for. */
export async function withdrawBriefAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ withdrawn: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("request.update_status");
    const { briefId } = parseInput(briefTarget, parseNestedFormData(formData));

    await briefs.withdraw(briefId, { ...staffActor(staff.user), userId: staff.user.id });

    revalidatePath(`/staff/requests`, "layout");
    refreshVendor(briefId);

    return ok({ withdrawn: true as const });
  });
}

/**
 * Staff post on the brief thread — the relay, and the whole mechanism of mediation.
 *
 * `visibility: "vendor"` and not `"customer"`: on this subject there is no customer to address, and
 * `vendor` is the level meaning "the other party in this thread reads it". A staff member who wants
 * to say something to the customer says it on the customer's own thread, which is a different screen
 * and a different action — and that separation is what stops a relayed message going the wrong way.
 */
export async function replyOnBriefAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ posted: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("message.reply_customer");
    const { briefId, body } = parseInput(replySchema, parseNestedFormData(formData));

    // Staff read the brief unscoped — they may see any of them — but the organisation still comes
    // from the brief rather than from the request, so both callers use one source for it.
    const organizationId = await briefs.threadScopeForStaff(briefId);

    await postMessage({
      organizationId,
      subjectType: "vendor_brief",
      subjectId: briefId,
      senderUserId: staff.user.id,
      senderType: "staff",
      body,
      visibility: "vendor",
    });

    revalidatePath(`/staff/requests`, "layout");
    refreshVendor(briefId);

    return ok({ posted: true as const });
  });
}

/* ────────────────────────────────────────────── vendor */

/**
 * The vendor replies.
 *
 * `requireVendorOrForbid()` gives the scope, and the scope goes into the service's query — a vendor
 * cannot reply on a brief that is not theirs because `threadScopeForVendor` refuses to hand back an
 * organisation for one, with a 404 rather than a 403.
 *
 * `visibility: "vendor"` again, for the same reason as the staff side: there is no customer on this
 * thread. A vendor has no way to write a customer-visible message here at all, which is stronger
 * than a checkbox they are asked not to tick.
 */
export async function replyAsVendorOnBriefAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ posted: true }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    const { briefId, body } = parseInput(replySchema, parseNestedFormData(formData));

    const organizationId = await briefs.threadScopeForVendor(briefId, {
      vendorId: context.vendorId,
    });

    await postMessage({
      organizationId,
      subjectType: "vendor_brief",
      subjectId: briefId,
      senderUserId: context.user.id,
      senderType: "vendor",
      body,
      visibility: "vendor",
    });

    refreshVendor(briefId);

    return ok({ posted: true as const });
  });
}

/** The vendor prices it — decision W1. */
export async function submitProposalAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ priced: true }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    const input = parseInput(proposalSchema, parseNestedFormData(formData));

    await briefs.submitProposal(
      { ...input, amount: fromDecimal(input.amount, input.currency as CurrencyCode).amount },
      { vendorId: context.vendorId },
      { ...vendorActor(context.user, context.vendorId), userId: context.user.id },
    );

    refreshVendor(input.briefId);

    return ok({ priced: true as const });
  });
}

/** The vendor says no, with a reason staff read verbatim. */
export async function declineBriefAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ declined: true }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    const input = parseInput(declineSchema, parseNestedFormData(formData));

    await briefs.decline(
      input,
      { vendorId: context.vendorId },
      { ...vendorActor(context.user, context.vendorId), userId: context.user.id },
    );

    refreshVendor(input.briefId);

    return ok({ declined: true as const });
  });
}
