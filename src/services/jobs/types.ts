import "server-only";

/**
 * The job catalogue — §86.
 *
 * A name→payload map in the same shape as `DomainEventMap`, for the same
 * reason: a job is enqueued in one file and handled in another, and without a
 * shared type the only thing checking they agree is whether anybody happened to
 * run it. Here a mistyped name or a missing field is a compile error.
 *
 * The map is exhaustive by design. There is no dynamic registration: a job that
 * is not listed here cannot be enqueued, which is what keeps the admin screen's
 * per-name breakdown meaningful rather than a list of whatever strings have
 * been passed lately.
 */
export interface JobPayloadMap {
  /**
   * One email. The generic one, and the reason §86 lists email first.
   *
   * Carries the rendered message rather than a notification id, so a retry
   * sends what was composed at the time. Re-rendering on retry would let a
   * later edit to a template silently change the content of a message the
   * customer has already been told is coming.
   */
  "send-email": {
    to: string;
    subject: string;
    text: string;
    html?: string;
    /** Stamped with `emailSentAt` on success, when present. */
    notificationId?: string;
  };

  /** Sweep: notifications with an `email` channel that never got stamped. */
  "retry-notification-emails": Record<string, never>;

  /** Sweep: `issued` quotes past `expiresAt` → `expired`. */
  "expire-quotes": Record<string, never>;

  /** Sweep: `issued` invoices with a balance and a `dueAt` in the past. */
  "mark-invoices-overdue": Record<string, never>;

  /** Sweep: due-soon and overdue invoice reminders. */
  "send-invoice-reminders": Record<string, never>;

  /** Sweep: follow-ups whose `dueAt` has passed and are still open. */
  "send-followup-reminders": Record<string, never>;

  /** Sweep: stuck webhook events and unconfirmed payments (ticket 13). */
  "reconcile-pending-payments": Record<string, never>;
}

/*
 * Four jobs the ticket names and this map does not have. Each is absent for a
 * reason, and an absent job with a reason is worth more than a stub:
 *
 * - `generate-quote-pdf` / `generate-invoice-pdf` — there is no PDF pipeline.
 *   `quote-document.tsx` and `invoice-document.tsx` are print-styled HTML and
 *   the browser's own print-to-PDF handles them. Adding headless Chrome to the
 *   deploy image to render pages we can already render was decided against.
 *
 * - `cleanup-expired-carts` — already done, by a TTL index on `Cart.expiresAt`.
 *   Mongo sweeps it. Reimplementing that as a job would be strictly worse: more
 *   code, more failure modes, same outcome.
 *
 * - `cleanup-orphaned-uploads` — cannot be built honestly here. Finding an
 *   orphan means listing the bucket and diffing against `productFiles`, and the
 *   bucket is shared with unrelated live applications including regulated PII;
 *   granting this app `s3:ListBucket` over it is a capability decision, not an
 *   implementation detail. `s3:DeleteObject` is denied too, so even a correct
 *   sweep could only produce a list. Left out rather than stubbed.
 */

export type JobName = keyof JobPayloadMap;

export type JobHandler<K extends JobName> = (payload: JobPayloadMap[K]) => Promise<void>;

export interface JobDefinition<K extends JobName = JobName> {
  name: K;
  handler: JobHandler<K>;
  maxAttempts: number;
  /** First retry delay in ms; doubles per attempt up to `backoffCapMs`. */
  backoffMs: number;
  backoffCapMs: number;
}

/**
 * A handler may raise this to say "do not retry me".
 *
 * The default is to retry, because the common failure is transient. But a
 * malformed payload will fail identically five times and then dead-letter, and
 * four of those attempts are noise in the log that hides the real failures. The
 * same retryable/terminal distinction `webhookEvents.markFailed` draws.
 */
export class PermanentJobError extends Error {
  readonly permanent = true;

  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export function isPermanent(error: unknown): boolean {
  return error instanceof PermanentJobError;
}
