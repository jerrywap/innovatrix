import "server-only";
import { enqueue } from "./queue";
import type { JobName } from "./types";

/**
 * Recurring work, as a table.
 *
 * ## No cron expressions
 *
 * Every entry here is "every N minutes". None of these sweeps cares what time
 * of day it runs — a reminder ladder that fires at 02:00 or 14:00 sends the
 * same emails, because the *stage* is derived from the invoice's due date
 * rather than from the clock. Adding a cron parser to express something no job
 * needs would be a dependency bought with nothing.
 *
 * If a job ever does need "09:00 in the customer's timezone", that is a
 * property of the job (it can defer itself with `runAt`), not of the scheduler.
 *
 * ## The idempotency key is the schedule
 *
 * There is no "last run at" column and no lock. Each tick computes the current
 * window from the wall clock and enqueues with a key derived from it, so a
 * hundred ticks inside one window produce one job — and two servers ticking
 * simultaneously produce one job, because the unique index arbitrates rather
 * than a leader election.
 */

export interface ScheduledJob {
  name: JobName;
  everyMinutes: number;
}

export const SCHEDULE: readonly ScheduledJob[] = [
  // Ticket 13's criterion: a dropped webhook must not leave a customer who paid
  // with nothing, and fifteen minutes is the longest that may go unnoticed.
  { name: "reconcile-pending-payments", everyMinutes: 15 },

  // Belt-and-braces under `send-email`'s own retries; see the handler.
  { name: "retry-notification-emails", everyMinutes: 15 },

  // Daily. These change a status or send a reminder off the back of a date
  // passing, and running them hourly would just find nothing eleven times.
  { name: "mark-invoices-overdue", everyMinutes: 24 * 60 },
  { name: "expire-quotes", everyMinutes: 24 * 60 },
  { name: "send-invoice-reminders", everyMinutes: 24 * 60 },
  { name: "send-followup-reminders", everyMinutes: 24 * 60 },
];

export interface ScheduleTickResult {
  enqueued: JobName[];
  /** Already enqueued for this window by another tick or another instance. */
  skipped: JobName[];
}

/**
 * Enqueue everything whose window has come round.
 *
 * `at` is a parameter so a test can drive two windows without waiting a day.
 */
export async function enqueueDueScheduled(at: Date = new Date()): Promise<ScheduleTickResult> {
  const result: ScheduleTickResult = { enqueued: [], skipped: [] };

  for (const job of SCHEDULE) {
    const window = Math.floor(at.getTime() / (job.everyMinutes * 60_000));

    const { created } = await enqueue(job.name, {} as never, {
      idempotencyKey: `schedule:${job.name}:${window}`,
    });

    if (created) result.enqueued.push(job.name);
    else result.skipped.push(job.name);
  }

  return result;
}
