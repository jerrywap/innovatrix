import "server-only";
import type { Types } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { Notification } from "@/lib/db/models/communication";
import { serverEnv } from "@/config/env";
import { emailTransport } from "@/services/email";
import { notificationEmail } from "@/emails/notification";
import { defineJob } from "../registry";
import { enqueue } from "../queue";

/**
 * `send-email` and `retry-notification-emails` — §86's first two bullets.
 *
 * ## Why the email moved out of the request
 *
 * §86 lists emails first among the things that must not happen inline, and the
 * reason is not latency. The notification driver used to call the transport
 * directly and swallow the failure, which meant a provider blip lost the email
 * silently — the in-app row said "notified" and nobody was. Enqueuing makes the
 * failure a row with an attempt count and a retry time.
 *
 * `emailSentAt` was already the intended handle for this; the sweep below is
 * the query the driver's comment promised.
 */

const EMAIL_MAX_ATTEMPTS = 5;

export function registerEmailJobs(): void {
  defineJob(
    "send-email",
    async (payload) => {
      await emailTransport().send({
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        ...(payload.html ? { html: payload.html } : {}),
      });

      if (payload.notificationId) {
        await Notification.updateOne(
          { _id: toObjectId(payload.notificationId) },
          { $set: { emailSentAt: new Date() }, $addToSet: { channels: "email" } },
        );
      }
    },
    // Longer than the default cap: a mail provider outage is measured in tens
    // of minutes, and five attempts inside an hour would burn them all before
    // it recovered.
    { maxAttempts: EMAIL_MAX_ATTEMPTS, backoffMs: 30_000, backoffCapMs: 6 * 3_600_000 },
  );

  /**
   * The sweep.
   *
   * Belt and braces over `send-email`'s own retries. The job row is the primary
   * mechanism; this catches the case the job row cannot — a notification whose
   * `send-email` was never enqueued at all, because the process died between
   * writing the notification and enqueuing the job. Those two writes are not in
   * one transaction (the notification insert is deliberately outside any, so a
   * slow mail provider cannot hold a domain write open), so the gap is real.
   */
  defineJob("retry-notification-emails", async () => {
    const cutoff = new Date(Date.now() - 5 * 60_000);

    const stranded = await Notification.find({
      channels: "email",
      emailSentAt: { $exists: false },
      createdAt: { $lte: cutoff },
    })
      // Bounded, because this runs on a schedule and an unbounded read on a
      // backlog is how a sweep takes the database down (§94).
      .limit(200)
      .lean<
        {
          _id: Types.ObjectId;
          recipientUserId: Types.ObjectId;
          title: string;
          body?: string;
          href: string;
          category: string;
        }[]
      >();

    if (stranded.length === 0) return;

    const { User } = await import("@/lib/db/models/identity");
    const users = await User.find({ _id: { $in: stranded.map((n) => n.recipientUserId) } })
      .select({ email: 1, name: 1 })
      .lean<{ _id: Types.ObjectId; email: string; name?: string }[]>();

    const byId = new Map(users.map((u) => [String(u._id), u]));

    for (const notification of stranded) {
      const user = byId.get(String(notification.recipientUserId));
      if (!user?.email) continue;

      const message = notificationEmail({
        to: user.email,
        ...(user.name ? { name: user.name } : {}),
        title: notification.title,
        ...(notification.body ? { body: notification.body } : {}),
        url: absolute(notification.href),
        category: notification.category,
      });

      await enqueue(
        "send-email",
        { ...message, notificationId: String(notification._id) },
        // Keyed on the notification, so a sweep running twice — or racing the
        // original enqueue — produces one email rather than two.
        { idempotencyKey: `send-email:notification:${String(notification._id)}` },
      );
    }
  });
}

/** A stored href is relative; an inbox needs the whole thing (§69). */
function absolute(href: string): string {
  return `${serverEnv().APP_URL.replace(/\/$/, "")}${href}`;
}
