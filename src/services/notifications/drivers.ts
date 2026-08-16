import "server-only";
import { notificationEmail } from "@/emails/notification";
import { registerChannel, type NotificationChannelDriver } from "./channels";

/**
 * The two channels that exist — §69.
 *
 * `in_app` is registered for completeness: the row is written by the dispatcher
 * before any channel runs, because it is the record rather than a message. The
 * driver exists so `registeredChannels()` tells the truth and so the
 * preferences screen has something to enumerate.
 */

const inApp: NotificationChannelDriver = {
  key: "in_app",
  async deliver() {
    // Nothing to do — see above. Not an omission.
  },
};

/**
 * Email — composed here, sent by ticket 25's `send-email` job.
 *
 * ## Why this enqueues rather than sends
 *
 * "Email failure does not roll back or block the domain transaction" is an
 * explicit criterion, and this used to satisfy it by catching the error and
 * logging it. That met the letter of the criterion and lost the email: nothing
 * ever tried again. §86 puts email first among the things that belong in a
 * queue for exactly this reason.
 *
 * Enqueuing keeps the guarantee — an enqueue failure is still caught below, and
 * the in-app row still stands — and adds the retry. The row's `channels`
 * records that email was *intended*, and the `retry-notification-emails` sweep
 * finds anything that got neither a job nor a stamp.
 *
 * ## The message is composed now, not at send time
 *
 * So a retry three hours later sends what the customer was told they would get,
 * rather than whatever the template says by then.
 */
const email: NotificationChannelDriver = {
  key: "email",
  async deliver(payload) {
    const message = notificationEmail({
      to: payload.recipient.email,
      ...(payload.recipient.name ? { name: payload.recipient.name } : {}),
      title: payload.title,
      ...(payload.body ? { body: payload.body } : {}),
      url: payload.url,
      category: payload.category,
    });

    try {
      const { enqueue } = await import("@/services/jobs/queue");
      await enqueue(
        "send-email",
        { ...message, notificationId: payload.notificationId },
        // One notification, one email, however many times dispatch re-runs.
        { idempotencyKey: `send-email:notification:${payload.notificationId}` },
      );
    } catch (error) {
      console.error(
        `[notifications] queueing email to ${payload.recipient.email} failed:`,
        error instanceof Error ? error.message : error,
      );
      // Deliberately not rethrown. The in-app notification stands, and the
      // sweep will find this row: an `email` channel with no `emailSentAt`.
    }
  },
};

let registered = false;

export function registerNotificationChannels(): void {
  if (registered) return;
  registerChannel(inApp);
  registerChannel(email);
  registered = true;
}
