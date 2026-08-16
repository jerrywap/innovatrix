import "server-only";
import type { Types } from "mongoose";
import { CustomerRequest, FollowUp } from "@/lib/db/models/requests";
import { emit } from "@/lib/events";
import { defineJob } from "../registry";

/**
 * Follow-up reminders — §39, §68.
 *
 * The `FollowUp` model has carried a `{status, dueAt}` index since ticket 20
 * with nothing querying it — it was put there for this sweep. `/staff` already
 * shows an overdue count, but a count only helps somebody who visits the page;
 * a reminder reaches the person who set it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nudge on the day, then once a week. Daily nagging gets muted. */
const REMIND_ON_DAYS = [0, 7, 14] as const;

const BATCH = 200;

export function registerStaffJobs(): void {
  defineJob("send-followup-reminders", async () => {
    const now = Date.now();

    const due = await FollowUp.find({ status: "open", dueAt: { $lte: new Date(now) } })
      .sort({ dueAt: 1 })
      .limit(BATCH)
      .lean<
        {
          _id: Types.ObjectId;
          ownerUserId: Types.ObjectId;
          subjectType: string;
          subjectId: Types.ObjectId;
          dueAt: Date;
          note: string;
        }[]
      >();

    if (due.length === 0) return;

    // One lookup for the batch, not one per row — the same shape as the
    // follow-up list view.
    const requests = await CustomerRequest.find({
      _id: {
        $in: due.filter((row) => row.subjectType === "request").map((row) => row.subjectId),
      },
    })
      .select({ reference: 1 })
      .lean<{ _id: Types.ObjectId; reference: string }[]>();

    const reference = new Map(requests.map((row) => [String(row._id), row.reference]));

    for (const followUp of due) {
      const daysOverdue = Math.floor((now - new Date(followUp.dueAt).getTime()) / DAY_MS);
      if (!REMIND_ON_DAYS.includes(daysOverdue as (typeof REMIND_ON_DAYS)[number])) continue;

      const ref = reference.get(String(followUp.subjectId));

      // The catalogue's audience for this is `assignee`, which reads
      // `assigneeUserId` from the dispatch context — `notifications/handlers.ts`
      // maps `ownerUserId` onto it.
      await emit("FollowUpDue", {
        followUpId: String(followUp._id),
        ownerUserId: String(followUp.ownerUserId),
        title: followUp.note,
        daysOverdue,
        // A follow-up whose subject is not a request has nowhere better to
        // point than the list it lives on. Better a working link to the right
        // screen than a broken one to the right row.
        href: ref ? `/staff/requests/${ref}` : "/staff/follow-ups",
      });
    }
  });
}
