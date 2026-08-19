"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formDataToObject, ok, parseInput, withAction } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import { requireOrg, requirePermission, requireVendorOrForbid } from "@/lib/auth/dal";
import { DISPUTE_OUTCOMES, DISPUTE_REASONS } from "@/lib/db/enums";
import { objectIdSchema } from "@/validators/common";
import { staffActor, vendorActor } from "@/services/audit";
import { postMessage } from "@/services/messaging/messaging-service";
import * as support from "@/services/vendors/support-service";

/**
 * Vendor support and disputes — vendor ticket 13.
 *
 * Three callers, and the asymmetry between them *is* the ticket:
 *
 * | Who | May |
 * |---|---|
 * | customer | open a thread, reply, raise a dispute, ask for a refund |
 * | vendor (any active member) | reply, raise a dispute, escalate |
 * | staff | reply (including internally), escalate, **resolve** |
 *
 * A vendor cannot resolve a dispute and cannot decide a refund — Innovatrix took the payment and
 * decides (decision **V4**). There is no action here that would let them, which is a stronger
 * guarantee than a permission they happen not to hold.
 */

const replySchema = z.object({
  conversationId: objectIdSchema,
  entitlementId: objectIdSchema,
  body: z.string().trim().min(1, "Write something first.").max(5000),
  /** A vendor may address the customer or leave a note for us. Never `internal`. */
  audience: z.enum(["customer", "vendor"]).default("customer"),
});

const openSchema = z.object({
  entitlementId: objectIdSchema,
  body: z.string().trim().min(1, "Say what you need help with.").max(5000),
});

const disputeSchema = z.object({
  conversationId: objectIdSchema,
  reason: z.enum(DISPUTE_REASONS),
  detail: z.string().trim().min(1, "Say what is wrong.").max(4000),
});

const resolveSchema = z.object({
  conversationId: objectIdSchema,
  outcome: z.enum(DISPUTE_OUTCOMES),
  reason: z.string().trim().min(1, "Both parties read this.").max(2000),
});

const escalateSchema = z.object({ conversationId: objectIdSchema });

function refresh() {
  revalidatePath("/dashboard/selling/support");
  revalidatePath("/dashboard/software", "layout");
  revalidatePath("/dashboard/messages");
  revalidatePath("/staff/disputes");
}

/* ────────────────────────────────────────────── the customer */

/**
 * Ask the vendor a question.
 *
 * The service takes the org scope from the session and refuses an entitlement that is not this
 * organisation's — with a 404, so an entitlement id somebody guessed is not confirmed.
 */
export async function openSupportThreadAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ conversationId: string; slaHours: number }>> {
  return withAction(async () => {
    const { user, organizationId } = await requireOrg();
    const input = parseInput(openSchema, formDataToObject(formData));

    const opened = await support.openThread(
      { entitlementId: input.entitlementId, body: input.body },
      { organizationId },
      { type: "customer", userId: user.id, ...(user.name ? { name: user.name } : {}) },
    );

    refresh();
    return ok({ conversationId: opened.conversationId, slaHours: opened.slaHours });
  });
}

/**
 * Reply as the customer.
 *
 * The same service call as opening a thread, because they are the same operation — the
 * conversation's unique `(subjectType, subjectId)` index means the second message continues the
 * first thread. Visibility is forced to `customer` by the messaging service whatever arrives.
 */
export async function replyAsCustomerAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ sent: true }>> {
  return withAction(async () => {
    const { user, organizationId } = await requireOrg();
    const input = parseInput(replySchema, formDataToObject(formData));

    // The entitlement carries the scope check, exactly as it does when the thread is opened.
    await support.openThread(
      { entitlementId: input.entitlementId, body: input.body },
      { organizationId },
      { type: "customer", userId: user.id, ...(user.name ? { name: user.name } : {}) },
    );

    refresh();
    return ok({ sent: true as const });
  });
}

/* ────────────────────────────────────────────── the vendor */

/**
 * Reply as the vendor — to the customer, or as a note to us.
 *
 * **Any active member**, not owner-only (vendor ticket 03): the person who knows why the software
 * behaved that way is whoever wrote it, and gating support on the account holder is how a Friday
 * becomes a Monday.
 *
 * `audience: "vendor"` is a note visible to us and to their own team and never to the customer.
 * `internal` is not offered and would be coerced anyway — since vendor ticket 13 made `internal`
 * mean staff-only, a vendor writing one would be writing a note they could not read back.
 */
export async function replyAsVendorAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ sent: true }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    const input = parseInput(replySchema, formDataToObject(formData));

    // Scope: the thread must be this vendor's. `listForVendor` is the scoped read, and this is
    // the same filter applied to one id — a vendor replying into somebody else's thread would be
    // the worst possible leak in a three-party conversation.
    const own = await support.listForVendor({ vendorId: context.vendorId }, { limit: 200 });
    const thread = own.find((row) => String(row._id) === input.conversationId);
    if (!thread) {
      // 404-shaped: not "you may not", which would confirm the thread exists.
      throw new Error("No such conversation.");
    }

    await postMessage({
      organizationId: String(thread.organizationId),
      subjectType: "vendor_support",
      subjectId: String(thread.subjectId),
      senderUserId: context.user.id,
      senderType: "vendor",
      body: input.body,
      visibility: input.audience,
    });

    refresh();
    return ok({ sent: true as const });
  });
}

/* ────────────────────────────────────────────── disputes */

/** Raise one as the customer. */
export async function raiseDisputeAsCustomerAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ raised: true }>> {
  return withAction(async () => {
    const { user } = await requireOrg();
    const input = parseInput(disputeSchema, formDataToObject(formData));

    await support.raiseDispute(
      { conversationId: input.conversationId, reason: input.reason, detail: input.detail },
      { type: "customer", userId: user.id },
      { type: "customer", userId: user.id, ...(user.name ? { name: user.name } : {}) },
    );

    refresh();
    return ok({ raised: true as const });
  });
}

/** Raise one as the vendor — any active member, and never owner-only. */
export async function raiseDisputeAsVendorAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ raised: true }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    const input = parseInput(disputeSchema, formDataToObject(formData));

    await support.raiseDispute(
      { conversationId: input.conversationId, reason: input.reason, detail: input.detail },
      { type: "vendor", userId: context.user.id },
      { ...vendorActor(context.user, context.vendorId) },
    );

    refresh();
    return ok({ raised: true as const });
  });
}

/**
 * Escalate — either party, or staff.
 *
 * `requireOrg()` rather than a permission: escalation is deliberately cheap, because making it
 * hard would mean the hourly sweep is the only thing that ever escalates. It adds staff and never
 * removes the vendor.
 */
export async function escalateThreadAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ escalated: true }>> {
  return withAction(async () => {
    const { user } = await requireOrg();
    const input = parseInput(escalateSchema, formDataToObject(formData));

    await support.escalate(input.conversationId, {
      type: "customer",
      userId: user.id,
      ...(user.name ? { name: user.name } : {}),
    });

    refresh();
    return ok({ escalated: true as const });
  });
}

/**
 * Staff decide.
 *
 * `vendor.review` — the same commercial judgement that decides who may sell here. The outcome and
 * the reason are both required, and the follow-up the dispute created is closed by the service so
 * a decided dispute does not stay on somebody's queue.
 *
 * What this deliberately does **not** do: perform the outcome. A refund, a delisting, a review
 * removal and a suspension each have their own service, guard and audit row, and a resolver that
 * triggered them would be a second way into all four.
 */
export async function resolveDisputeAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ resolved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.review");
    const input = parseInput(resolveSchema, formDataToObject(formData));

    await support.resolveDispute(input.conversationId, input.outcome, input.reason, {
      ...staffActor(staff.user),
      userId: staff.user.id,
    });

    refresh();
    return ok({ resolved: true as const });
  });
}
