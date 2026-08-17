import "server-only";
import { registerEmailJobs } from "./email";
import { registerBillingJobs } from "./billing";
import { registerStaffJobs } from "./staff";
import { registerPaymentJobs } from "./payments";
import { registerVendorJobs } from "./vendors";

/**
 * Every job definition, registered once.
 *
 * Idempotent, and called from three places — `instrumentation.register()` at
 * boot, `drainQueue()` before it looks a handler up, and the tests. The last
 * two matter because a cold serverless instance has never run boot code, and a
 * worker that claimed a job it has no handler for dead-letters it.
 */

let registered = false;

export function registerJobs(): void {
  if (registered) return;

  registerEmailJobs();
  registerBillingJobs();
  registerStaffJobs();
  registerPaymentJobs();
  registerVendorJobs();

  registered = true;
}

/** Tests only — pairs with `resetJobRegistry()`. */
export function resetJobRegistration(): void {
  registered = false;
}
