import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import { payments } from "@/repositories/payment.repository";
import { webhookEvents } from "@/repositories/webhook-event.repository";
import { driverFor } from "@/services/payments/registry";
import { processPaymentSucceeded } from "@/services/payments/fulfilment";
import { processWebhookEvent } from "@/services/payments/webhook-processor";
import { defineJob } from "../registry";
import { log } from "@/lib/logger";
import { alert, ALERTS, ALERT_THRESHOLDS } from "@/lib/alerts";

/**
 * The safety net — §87, moved here from `/api/cron/reconcile`.
 *
 * The logic is unchanged and deliberately so: it was already correct and had
 * been verified live. What changes is where it runs. As a route body it had no
 * attempt count, no backoff and no record that it had failed — a reconciliation
 * that threw was a 500 in a scheduler's log, which is the one place nobody
 * reads. As a job it dead-letters onto `/admin/jobs` like everything else.
 *
 * ## Why it stays idempotent rather than relying on the queue
 *
 * The queue guarantees a job is not run *concurrently*; it does not guarantee
 * a job runs *once*. A worker killed after fulfilling but before `complete()`
 * leaves the row claimed, and the lease reclaim will run it again. Both sweeps
 * survive that because both funnel into `processPaymentSucceeded`, which
 * re-verifies and re-checks the amount — the same property that lets a webhook
 * and this sweep race safely.
 */

const STUCK_EVENT_AGE_MS = 60_000;
const PENDING_PAYMENT_AGE_MS = 10 * 60_000;
const BATCH = 25;

export interface ReconcileSummary {
  events: { examined: number; processed: number };
  payments: { examined: number; fulfilled: number; stillPending: number };
}

export function registerPaymentJobs(): void {
  defineJob(
    "reconcile-pending-payments",
    async () => {
      const summary = await reconcile();
      log.info("Reconciliation swept", { code: "payment.reconciled", ...summary });
    },
    // Three attempts, not five. It runs every fifteen minutes anyway, so a
    // fourth retry would collide with the next scheduled run and reconcile the
    // same rows twice for nothing.
    { maxAttempts: 3, backoffMs: 60_000, backoffCapMs: 600_000 },
  );
}

/**
 * Exported so the route can still run it inline.
 *
 * `/api/cron/reconcile` predates the queue and something may already be hitting
 * it on a schedule; changing it to enqueue-and-return would silently stop
 * reconciling for anyone whose worker is not running. It enqueues *and* runs.
 */
export async function reconcile(): Promise<ReconcileSummary> {
  await connectToDatabase();

  return {
    events: await sweepStuckEvents(),
    payments: await sweepPendingPayments(),
  };
}

async function sweepStuckEvents(): Promise<{ examined: number; processed: number }> {
  const stuck = await webhookEvents.stuckSince(
    new Date(Date.now() - STUCK_EVENT_AGE_MS),
    BATCH,
  );
  let processed = 0;

  for (const event of stuck) {
    try {
      // `claim()` inside guards on `status: "received"`, so an event a webhook
      // is *currently* handling is skipped rather than duplicated.
      const result = await processWebhookEvent(String(event._id));
      if (result) processed += 1;
    } catch (error) {
      // Per item, so one poisoned event does not cost the other twenty-four
      // theirs. The job itself only fails if something structural does.
      log.exception("Reconciliation could not process a webhook event", error, {
        code: "payment.reconcile_event_failed",
        eventId: String(event._id),
      });
    }
  }

  return { examined: stuck.length, processed };
}

async function sweepPendingPayments(): Promise<{
  examined: number;
  fulfilled: number;
  stillPending: number;
}> {
  const pending = await payments.pendingSince(
    new Date(Date.now() - PENDING_PAYMENT_AGE_MS),
    BATCH,
  );

  let fulfilled = 0;
  let stillPending = 0;

  for (const payment of pending) {
    try {
      const verified = await driverFor(payment.provider).verify(payment.providerRef);

      if (verified.status !== "succeeded") {
        stillPending += 1;

        /*
         * §95: "alert on payments pending > 30 min".
         *
         * The sweep looks at anything over ten minutes, and most of those are
         * ordinary — a customer with the provider's page still open. Past
         * thirty the provider has been asked and still does not recognise it,
         * which means either money is in limbo or a reference was lost.
         */
        const age = Date.now() - new Date(payment.createdAt).getTime();
        if (age > ALERT_THRESHOLDS.paymentPendingMinutes * 60_000) {
          alert(ALERTS.paymentStuck, "A payment has been pending too long", {
            payment: payment.reference,
            provider: payment.provider,
            minutes: Math.round(age / 60_000),
          });
        }

        continue;
      }

      // The same path a webhook takes. It re-verifies (a second call, and worth
      // it) and re-checks the amount, so nothing is trusted from here either.
      const result = await processPaymentSucceeded({
        provider: payment.provider,
        providerRef: payment.providerRef,
        source: "reconciliation",
        actor: { type: "system" },
      });

      if (result.outcome === "fulfilled") fulfilled += 1;
    } catch (error) {
      log.exception("Reconciliation could not verify a payment", error, {
        code: "payment.reconcile_verify_failed",
        payment: payment.reference,
        provider: payment.provider,
      });
    }
  }

  return { examined: pending.length, fulfilled, stillPending };
}
