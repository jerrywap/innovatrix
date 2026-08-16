"use server";

import { revalidatePath } from "next/cache";
import type { Types } from "mongoose";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { requireStaff } from "@/lib/auth/dal";
import { REQUEST_STATUSES, SUBJECT_TYPES } from "@/lib/db/enums";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { FollowUp } from "@/lib/db/models/requests";
import { objectIdSchema } from "@/validators/common";
import {
  assign,
  setInternalInterpretation,
  transition,
  type RequestActor,
} from "@/services/requests/request-service";

/**
 * Staff actions on a request — §32, §34, §40.
 *
 * ## The actor carries permissions, and the service decides
 *
 * These actions do not check what the staff member may do. They build a
 * `RequestActor` from the session and hand it to `RequestService`, which
 * consults `REQUEST_TRANSITION_RULES`. One place decides; a screen cannot
 * accidentally authorise something by rendering a button.
 */

async function staffActorFromSession(): Promise<Extract<RequestActor, { type: "staff" }>> {
  const staff = await requireStaff();
  return {
    type: "staff",
    userId: staff.user.id,
    ...(staff.user.name ? { name: staff.user.name } : {}),
    permissions: staff.permissions,
  };
}

export async function transitionRequestAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ status: string }>> {
  return withAction(async () => {
    const parsed = parseInput(
      z.object({
        requestId: objectIdSchema,
        to: z.enum(REQUEST_STATUSES),
        note: z.string().trim().max(500).optional(),
        internalNote: z.string().trim().max(2000).optional(),
        reference: z.string().trim().min(1).max(40),
      }),
      Object.fromEntries(formData.entries()),
    );

    const updated = await transition({
      requestId: parsed.requestId,
      to: parsed.to,
      actor: await staffActorFromSession(),
      ...(parsed.note ? { note: parsed.note } : {}),
      ...(parsed.internalNote ? { internalNote: parsed.internalNote } : {}),
    });

    revalidatePath(`/staff/requests/${parsed.reference}`);
    revalidatePath("/staff");
    return ok({ status: updated.status });
  });
}

export async function assignRequestAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ assigned: true }>> {
  return withAction(async () => {
    const parsed = parseInput(
      z.object({
        requestId: objectIdSchema,
        assigneeUserId: objectIdSchema,
        note: z.string().trim().max(300).optional(),
        reference: z.string().trim().min(1).max(40),
      }),
      Object.fromEntries(formData.entries()),
    );

    await assign({
      requestId: parsed.requestId,
      actor: await staffActorFromSession(),
      assigneeUserId: parsed.assigneeUserId,
      ...(parsed.note ? { note: parsed.note } : {}),
    });

    revalidatePath(`/staff/requests/${parsed.reference}`);
    revalidatePath("/staff");
    return ok({ assigned: true as const });
  });
}

/**
 * §34 — the staff-owned reading, stored apart from what the customer confirmed.
 *
 * This is the field that exists so `customerRequirements` never has to be
 * edited. A staff member who thinks the customer means something else writes it
 * here, and both are shown side by side.
 */
export async function saveInterpretationAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const parsed = parseInput(
      z.object({
        requestId: objectIdSchema,
        text: z.string().trim().max(4000),
        reference: z.string().trim().min(1).max(40),
      }),
      Object.fromEntries(formData.entries()),
    );

    await setInternalInterpretation({
      requestId: parsed.requestId,
      actor: await staffActorFromSession(),
      text: parsed.text,
    });

    revalidatePath(`/staff/requests/${parsed.reference}`);
    return ok({ saved: true as const });
  });
}

/* ────────────────────────────────────────────── follow-ups (§39) */

/**
 * "Follow up with them Tuesday."
 *
 * ## The owner defaults to whoever created it, and can be someone else
 *
 * §39 makes the owner explicit rather than implied, because the useful case is
 * often "I'll note this for Priya" — and a follow-up assigned to nobody in
 * particular is one nobody picks up.
 *
 * ## Not audited, deliberately
 *
 * A reminder is not a change to a customer's record. Auditing every "check this
 * Monday" would bury the entries that matter — a status change, a payment, an
 * interpretation edit — under a stream of private notes. It is internal-only
 * and produces no activity event for the same reason.
 */
export async function createFollowUpAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ created: true }>> {
  return withAction(async () => {
    // Any staff member who can see a request can set a reminder about it.
    // Gating this harder would make people keep reminders in their own notes,
    // which is the outcome §39 exists to prevent.
    const staff = await requireStaff();

    const parsed = parseInput(
      z.object({
        organizationId: objectIdSchema,
        subjectType: z.enum(SUBJECT_TYPES),
        subjectId: objectIdSchema,
        note: z.string().trim().min(1, "Say what to follow up on").max(500),
        dueAt: z.string().trim().min(1, "Pick a date"),
        ownerUserId: objectIdSchema.optional(),
        returnTo: z.string().trim().max(200).optional(),
      }),
      Object.fromEntries(formData.entries()),
    );

    const dueAt = new Date(parsed.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      return fail("That date doesn't look right.", {
        fieldErrors: { dueAt: ["Use a real date."] },
      });
    }

    await connectToDatabase();
    await FollowUp.create({
      organizationId: toObjectId(parsed.organizationId),
      ownerUserId: toObjectId(parsed.ownerUserId ?? staff.user.id),
      subjectType: parsed.subjectType,
      subjectId: toObjectId(parsed.subjectId),
      dueAt,
      note: parsed.note,
      status: "open",
    });

    revalidatePath("/staff");
    revalidatePath("/staff/follow-ups");
    if (parsed.returnTo) revalidatePath(parsed.returnTo);

    return ok({ created: true as const });
  });
}

/** Done, or no longer needed. Kept either way — the list is a record. */
export async function resolveFollowUpAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ resolved: true }>> {
  return withAction(async () => {
    await requireStaff();

    const parsed = parseInput(
      z.object({
        followUpId: objectIdSchema,
        outcome: z.enum(["done", "cancelled"]),
      }),
      Object.fromEntries(formData.entries()),
    );

    await connectToDatabase();
    const updated = await FollowUp.findOneAndUpdate(
      { _id: toObjectId(parsed.followUpId), status: "open" },
      { $set: { status: parsed.outcome, completedAt: new Date() } },
      { returnDocument: "after" },
    ).lean();

    // Already closed by somebody else. Not an error worth showing — the
    // outcome the user wanted is the outcome they have.
    if (!updated) return ok({ resolved: true as const });

    revalidatePath("/staff");
    revalidatePath("/staff/follow-ups");
    return ok({ resolved: true as const });
  });
}

/* ────────────────────────────────────────────── bulk assign (§32, §40) */

/**
 * Assign several requests at once — §32's "bulk assign".
 *
 * ## Partial success is the normal outcome, not an error
 *
 * A triage session picks ten rows and presses assign. One of them may have been
 * picked up by somebody else in the meantime, or moved to a state that no
 * longer accepts it. Failing the whole batch because one row moved would make
 * the feature useless exactly when it is busiest.
 *
 * So each is attempted independently and the result says how many landed.
 * Every one still goes through `assign()`, so the history, the audit row and
 * the permission check are the same as a single assignment — this is a loop,
 * not a second implementation.
 */
export async function bulkAssignAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ assigned: number; skipped: number }>> {
  return withAction(async () => {
    const actor = await staffActorFromSession();

    const parsed = parseInput(
      z.object({
        assigneeUserId: objectIdSchema,
        note: z.string().trim().max(300).optional(),
        queueKey: z.string().trim().max(60).optional(),
      }),
      Object.fromEntries(formData.entries()),
    );

    // `getAll`, because the checkboxes share a name. `Object.fromEntries`
    // above keeps only the last one — which is why the ids are read separately
    // rather than through the parsed object.
    const requestIds = formData
      .getAll("requestIds")
      .map(String)
      .filter((id) => /^[a-f\d]{24}$/i.test(id));

    if (requestIds.length === 0) {
      return fail("Pick at least one request.");
    }

    let assigned = 0;
    for (const requestId of requestIds) {
      try {
        await assign({
          requestId,
          actor,
          assigneeUserId: parsed.assigneeUserId,
          ...(parsed.note ? { note: parsed.note } : {}),
        });
        assigned += 1;
      } catch {
        // Moved, deleted, or otherwise no longer assignable. Counted, not
        // fatal — see the note above.
      }
    }

    revalidatePath("/staff");
    if (parsed.queueKey) revalidatePath(`/staff/queue/${parsed.queueKey}`);

    return ok({ assigned, skipped: requestIds.length - assigned });
  });
}

/** Staff who can own a request, for the assignee picker. */
export async function assignableStaffAction(): Promise<
  ActionResult<Array<{ id: string; name: string }>>
> {
  return withAction(async () => {
    await requireStaff();
    await connectToDatabase();

    const { StaffProfile, User } = await import("@/lib/db/models/identity");

    const profiles = await StaffProfile.find({ isActive: true })
      .select({ userId: 1 })
      .lean<{ userId: Types.ObjectId }[]>();

    const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
      .select({ name: 1, email: 1 })
      .lean<{ _id: unknown; name?: string; email: string }[]>();

    return ok(
      users
        .map((user) => ({ id: String(user._id), name: user.name ?? user.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  });
}
