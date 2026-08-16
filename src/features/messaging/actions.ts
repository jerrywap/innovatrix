"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { requireOrg, requireStaff } from "@/lib/auth/dal";
import { CONVERSATION_SUBJECT_TYPES } from "@/lib/db/enums";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { CustomerRequest } from "@/lib/db/models/requests";
import { objectIdSchema } from "@/validators/common";
import { postMessage, markThreadRead } from "@/services/messaging/messaging-service";
import { transition } from "@/services/requests/request-service";

/**
 * Posting a message — §37, §38.
 *
 * ## Two actions, not one with a role check
 *
 * `replyAsCustomer` and `replyAsStaff` are separate entry points. A single
 * action taking `senderType` would need a branch deciding whether the caller is
 * allowed to claim the one they sent — and that branch is the whole security
 * boundary, sitting in the same function as the happy path.
 *
 * Separated, a customer's action **cannot express** an internal note: it does
 * not take a visibility, and the service forces `customer` for a customer
 * sender regardless.
 */

const bodySchema = z.object({
  subjectType: z.enum(CONVERSATION_SUBJECT_TYPES),
  subjectId: objectIdSchema,
  reference: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1, "Write something first").max(5000),
});

export async function replyAsCustomerAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ sent: true }>> {
  return withAction(async () => {
    const { organizationId, user } = await requireOrg();
    const parsed = parseInput(bodySchema, Object.fromEntries(formData.entries()));

    // Scope: the subject must belong to their organisation. Without this a
    // customer could post into another organisation's thread by id.
    await assertSubjectBelongs(parsed.subjectType, parsed.subjectId, organizationId);

    await postMessage({
      organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      senderUserId: user.id,
      senderType: "customer",
      body: parsed.body,
      // Coerced by the service anyway; passed explicitly so the intent is
      // readable rather than relying on a default two files away.
      visibility: "customer",
    });

    /*
     * §31's "Awaiting Staff Response": a customer replying to a question moves
     * the request back to us. Best-effort — a reply that cannot move the status
     * (already quoted, already converted) is still a reply worth keeping, and
     * failing the send because the machine said no would lose their message.
     */
    if (parsed.subjectType === "request") {
      await transition({
        requestId: parsed.subjectId,
        to: "under_review",
        actor: {
          type: "customer",
          userId: user.id,
          organizationId,
          ...(user.name ? { name: user.name } : {}),
        },
        note: "You replied",
      }).catch(() => {});
    }

    revalidatePath(`/dashboard/requests/${parsed.reference}`);
    revalidatePath(`/staff/requests/${parsed.reference}`);
    return ok({ sent: true as const });
  });
}

export async function replyAsStaffAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ sent: true; visibility: "customer" | "internal" }>> {
  return withAction(async () => {
    const staff = await requireStaff();

    const parsed = parseInput(
      bodySchema.extend({
        organizationId: objectIdSchema,
        // No default. §37's criterion is that switching to a customer reply is
        // *deliberate*, and a default is the opposite of deliberate — an
        // omitted field must not silently become the visible one.
        visibility: z.enum(["customer", "internal"]),
      }),
      Object.fromEntries(formData.entries()),
    );

    if (parsed.visibility === "customer" && !staff.permissions.has("message.reply_customer")) {
      return fail("You can add internal notes, but not reply to the customer.");
    }

    await postMessage({
      organizationId: parsed.organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      senderUserId: staff.user.id,
      senderType: "staff",
      body: parsed.body,
      visibility: parsed.visibility,
    });

    revalidatePath(`/staff/requests/${parsed.reference}`);
    if (parsed.visibility === "customer") {
      revalidatePath(`/dashboard/requests/${parsed.reference}`);
    }

    return ok({ sent: true as const, visibility: parsed.visibility });
  });
}

export async function markReadAction(input: unknown): Promise<ActionResult<{ read: true }>> {
  return withAction(async () => {
    const { organizationId, user } = await requireOrg();

    const parsed = parseInput(
      z.object({
        subjectType: z.enum(CONVERSATION_SUBJECT_TYPES),
        subjectId: objectIdSchema,
      }),
      input,
    );

    await markThreadRead({
      organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      userId: user.id,
      audience: "customer",
    });

    return ok({ read: true as const });
  });
}

/**
 * Does this subject belong to that organisation?
 *
 * Only `request` is checkable today — orders and quotes get their own threads
 * in tickets 22 and 23, and this is where their check goes. Refusing the
 * unchecked types is deliberate: silently allowing a subject nobody validated
 * would make the scope guarantee depend on which branch happened to exist.
 */
async function assertSubjectBelongs(
  subjectType: "request" | "order" | "quote",
  subjectId: string,
  organizationId: string,
): Promise<void> {
  await connectToDatabase();

  if (subjectType === "request") {
    const exists = await CustomerRequest.exists({
      _id: toObjectId(subjectId),
      organizationId: toObjectId(organizationId),
    });
    if (!exists) throw new Error("No such request.");
    return;
  }

  throw new Error("Messaging isn't available on that yet.");
}
