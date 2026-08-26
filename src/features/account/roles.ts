import type { OrganizationRole } from "@/lib/db/enums";

/**
 * Who may see and correct the organisation's billing details.
 *
 * In its own module rather than beside the action that enforces it, because a
 * `"use server"` file may only export async functions — exporting this array from
 * `actions.ts` compiled cleanly, typechecked cleanly, and failed the production
 * build with *"a 'use server' file can only export async functions, found
 * object"*. Worth knowing: `next build` is the only gate that catches it.
 *
 * One list, read by the page's guard, the action's re-check and the tab rail, so
 * what is drawn and what is allowed cannot disagree. Mirrors how `Invoices` is
 * gated in `CUSTOMER_NAV`: a technical contact has no business in the billing
 * address, and a `member` even less.
 */
export const BILLING_ROLES = [
  "owner",
  "admin",
  "billing",
] as const satisfies readonly OrganizationRole[];
