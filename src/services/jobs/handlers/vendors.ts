import "server-only";
import { defineJob } from "../registry";
import { PermanentJobError } from "../types";
import { log } from "@/lib/logger";

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
}
