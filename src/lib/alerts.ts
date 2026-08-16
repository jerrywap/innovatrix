import "server-only";
import { log } from "@/lib/logger";

/**
 * The conditions somebody must be told about — §95, ticket 27.
 *
 * ## Why a seam rather than an integration
 *
 * §95 says production "should eventually include" error tracking, and the
 * honest state is that there is no Sentry DSN, no PagerDuty and no on-call
 * rotation yet. Wiring a client against credentials that do not exist produces
 * code that has never run.
 *
 * What *can* be done now, and is the part that would otherwise be forgotten, is
 * deciding **which conditions are alerts** and emitting them with stable codes.
 * A log line with `code: "payment.stuck"` is greppable today and is a routing
 * rule the moment there is somewhere to route it. Adding Sentry later is this
 * one function.
 *
 * ## Stable codes, not messages
 *
 * The message is for a person; the code is for a rule. A code that changes
 * because somebody improved the wording silently disables the alert built on it.
 */

export const ALERTS = {
  /** A provider sent something we could not verify. Either a bug or an attack. */
  webhookVerificationFailed: "webhook.verification_failed",
  /** Money left the customer and we have not confirmed it. §87's safety net. */
  paymentStuck: "payment.stuck",
  /** An amount that did not match. Nothing was fulfilled; somebody must look. */
  paymentRequiresReview: "payment.requires_review",
  /** A job exhausted its attempts. §86: nothing silently disappears. */
  jobDeadLettered: "job.dead_lettered",
  /** The queue is not moving. Different from deep — deep and moving is fine. */
  queueStalled: "job.queue_stalled",
  /** A dependency the app cannot work without is unreachable. */
  dependencyDown: "health.dependency_down",
} as const;

export type AlertCode = (typeof ALERTS)[keyof typeof ALERTS];

/**
 * Raise an alert.
 *
 * Always `error` level, whatever the severity of the underlying thing: an alert
 * that logs at `info` is an alert nobody has configured a rule for. If it is
 * not worth `error`, it is not an alert — call `log.warn` directly.
 */
export function alert(
  code: AlertCode,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  log.error(message, { ...fields, code, alert: true });
}

/** Thresholds, in one place so they can be argued with. */
export const ALERT_THRESHOLDS = {
  /** §95: "payments pending > 30 min". Longer than reconciliation's 10. */
  paymentPendingMinutes: 30,
  /** A pending job older than this means the worker is not running. */
  queueOldestPendingMinutes: 30,
  /** Any dead letter at all is worth a look; this is when it is worth waking. */
  deadLetterCount: 5,
} as const;
