import "server-only";
import { defineJob } from "../registry";
import { PermanentJobError } from "../types";
import { log } from "@/lib/logger";
import { clearDueEarnings } from "@/services/vendors/ledger-service";
import { draftBatch, reconcileSending } from "@/services/payouts/payout-service";

/**
 * Vendor jobs — vendor ticket 06.
 *
 * ## Why the artefact fetch is here rather than inline
 *
 * The mirror and repository delivery methods fetch from a URL a vendor chose, over a
 * link we do not control, for an artefact that may be gigabytes. That is three reasons
 * it cannot sit in a request: the timeout, the memory, and the fact that a transient
 * failure should be retried rather than shown to somebody as a broken button.
 *
 * Retries are generous but bounded. Five attempts with a five-minute base and a
 * six-hour cap covers a vendor's server being down overnight; past that it
 * dead-letters, appears on `/admin/jobs`, and the version stays un-released with a
 * reason on it — which is the outcome that matters, because a released version whose
 * artefact never arrived would be a download that 404s for a paying customer.
 */
export function registerVendorJobs(): void {
  defineJob(
    "mirror-vendor-artefact",
    async ({ versionId }) => {
      const { mirrorArtefact } = await import("@/services/catalog/artefact-service");
      const { NotFoundError, ValidationError } = await import("@/lib/errors");

      try {
        const result = await mirrorArtefact(versionId, { type: "system" });
        if (result.outcome === "stored") {
          log.info("Mirrored a vendor artefact", {
            code: "vendor_artefact.stored",
            versionId,
            fileId: result.fileId,
          });
        }
      } catch (error) {
        /*
         * A wrong checksum, a refused host, a file over the cap or a deleted version are
         * **permanent**: retrying changes nothing, and burning five attempts on them
         * delays the dead-letter that tells somebody to look. A 503 from the vendor's
         * server is the transient case, and that is what the retries are for.
         */
        if (error instanceof ValidationError || error instanceof NotFoundError) {
          throw new PermanentJobError(
            error instanceof Error ? error.message : "The artefact could not be fetched.",
          );
        }
        throw error;
      }
    },
    { maxAttempts: 5, backoffMs: 5 * 60_000, backoffCapMs: 6 * 3_600_000 },
  );

  /**
   * Vendor ticket 08 — earnings whose clearance date has passed become payable.
   *
   * **Idempotent by its filter** rather than by a marker: `{ status: "pending", clearsAt:
   * { $lte: now } }` finds nothing the second time it runs, so a double tick, a manual
   * "run now" on `/admin/jobs` and a retry after a crash all produce the same ledger.
   *
   * Unbounded on purpose, unlike the reminder sweeps: this is one indexed `updateMany`
   * over `{status, clearsAt}` rather than a per-document loop that sends an email, and a
   * `BATCH` cap would mean some vendors' money cleared a day late for no reason a vendor
   * could be told.
   *
   * Never retried, and it does not need to be — tomorrow's tick clears whatever today's
   * missed, and being one day late is the failure mode rather than money being lost.
   */
  defineJob("clear-vendor-earnings", async () => {
    const { cleared } = await clearDueEarnings();

    if (cleared > 0) {
      log.info("Vendor earnings cleared", { code: "vendor_ledger.cleared", cleared });
    }
  });

  /**
   * Vendor ticket 09 — prepare the batch. **It cannot send anything.**
   *
   * That is the design and not a limitation: `draft → approved` is a human transition, so a
   * job holding `payout.approve` would be the one thing this ticket set out to prevent —
   * money leaving on a schedule with nobody looking.
   *
   * Runs daily against a monthly cadence, because the question it asks is "has this period
   * been drafted" and the unique `(vendorId, period)` index answers it. Cheap when there is
   * nothing to do, and one missed run costs a day rather than a month.
   *
   * Both halves are logged. A run that skipped every vendor is not a quiet success — it is
   * the shape of a misconfigured threshold, and the counts are what make that visible.
   */
  defineJob("draft-vendor-payouts", async () => {
    const outcome = await draftBatch();

    if (outcome.drafted.length > 0 || outcome.skipped.length > 0) {
      log.info("Vendor payout batch drafted", {
        code: "vendor_payout.batch",
        drafted: outcome.drafted.length,
        skipped: outcome.skipped.length,
        // The reasons, counted. "Eleven vendors skipped" prompts a question; "eleven
        // unverified" answers it.
        reasons: outcome.skipped.reduce<Record<string, number>>((acc, skip) => {
          acc[skip.reason] = (acc[skip.reason] ?? 0) + 1;
          return acc;
        }, {}),
      });
    }
  });

  /**
   * Vendor ticket 09 — a payout stuck in `sending`.
   *
   * The outbound twin of `reconcile-pending-payments`. An automated driver can be asked and
   * the payout resolved; the `manual` driver truthfully answers "still sending", so those
   * are **surfaced at warning level** for a person rather than left to a sweep that cannot
   * decide anything. For a manual payout the person *is* the provider.
   */
  defineJob("reconcile-sending-payouts", async () => {
    const { checked, resolved, stuck } = await reconcileSending();

    if (resolved > 0) {
      log.info("Stuck payouts resolved", { code: "vendor_payout.resolved", checked, resolved });
    }

    for (const payout of stuck) {
      log.warn("A payout has been sending for too long", {
        code: "vendor_payout.stuck",
        reference: payout.reference,
        payoutId: String(payout._id),
        vendorId: String(payout.vendorId),
        // No amount in the log line: it would put money into log aggregation for no
        // operational gain, and the reference is enough to open the payout.
        method: payout.method,
      });
    }
  });
}
