import { STAFF_ROLES, type StaffRole } from "@/lib/db/enums";

/**
 * Staff permissions — §77.
 *
 * The spec is explicit: *"Use permissions rather than one universal admin
 * flag."* So the atomic unit here is a **permission**, and a role is nothing
 * but a named bundle of them. There is no `isAdmin` shortcut anywhere in the
 * codebase, and adding one later would defeat the whole structure — a boolean
 * cannot express "finance may refund but must not publish products".
 *
 * A user's effective permissions are the **union** of their roles'. Roles are a
 * set, not a hierarchy: someone can be both `sales` and `finance` without a
 * containing role existing for the combination.
 *
 * This module is deliberately pure and dependency-free so that ticket 26's
 * authorization audit can import it, enumerate every permission, and check that
 * each one is actually enforced somewhere. Keep it that way — no database
 * access, no request context.
 *
 * ## Not to be confused with organization roles
 *
 * `OrganizationRole` (owner/admin/billing/technical/member) governs what a
 * *customer* may do inside their own organization, and is enforced by Better
 * Auth's access-control plugin (`src/lib/auth/organization-access.ts`). The
 * matrix here governs what *staff* may do across the whole platform. The two
 * never mix: a customer has no staff permissions, and a staff member's
 * permissions grant nothing inside a customer organization they don't belong
 * to.
 */

/* ────────────────────────────────────────────── permissions */

/**
 * Every permission in the system, grouped by the resource it acts on. The
 * `resource.action` shape is load-bearing: it keeps the list scannable and lets
 * ticket 26 group findings by resource.
 */
export const PERMISSIONS = [
  /* Catalogue (§46) — publishing is separate from editing on purpose: a
     content manager writes the listing, a marketplace manager decides it may
     be sold. */
  "product.view_all",
  "product.create",
  "product.update",
  "product.publish",
  "product.unpublish",
  "product.delete",
  "product.manage_files",
  "product.manage_pricing",

  /* Taxonomy — categories, industries, technologies. */
  "taxonomy.manage",

  /* Customers & organizations */
  "customer.view_all",
  "customer.update",
  "customer.impersonate",

  /* Custom software requests (§17–§23) */
  "request.view_all",
  "request.assign",
  "request.update_status",
  "request.comment_internal",
  "request.close",

  /* Quotes (§21, §61) */
  "quote.view_all",
  "quote.draft",
  "quote.issue",
  "quote.revise",
  "quote.withdraw",

  /* Orders & fulfilment (§62) */
  "order.view_all",
  "order.update_status",
  "order.cancel",
  "order.grant_entitlement",

  /* Money (§84, §87). Refunds are separated from everything else in billing
     because they move money outward and are the most abusable action here. */
  "payment.view_all",
  "payment.refund",
  "payment.reconcile",
  /* Recording a bank transfer runs the *identical* fulfilment path as a
     verified card payment — it creates real licences without a provider
     having confirmed anything. Separated from `reconcile` for that reason. */
  "payment.record_manual",
  "invoice.view_all",
  "invoice.issue",
  "invoice.void",

  /* Pricing levers (ticket 10). Separate from `product.manage_pricing`: that
     sets what a product costs, these change what everyone pays at the till. */
  "discount.manage",
  "tax.manage",

  /* Projects & delivery */
  "project.view_all",
  "project.manage",
  "project.update_milestone",

  /* Messaging (§37) — the internal/customer split is a permission, not a UI
     affordance, because an internal note must never reach a customer. */
  "message.view_all",
  "message.reply_customer",

  /* Platform administration (§89, §90) */
  "settings.manage",
  "payment_provider.configure",
  /**
   * Which model the assistants use, and the failover order (ticket 16).
   *
   * Separate from `settings.manage` because it has its own blast radius: this
   * one changes what every customer conversation costs per turn and how well it
   * behaves, and §104 makes it the lever somebody reaches for during an
   * incident. Worth being able to grant on its own, and worth auditing on its
   * own. It never grants access to the API key, which is not in the database.
   */
  "ai.configure",
  "staff.manage",
  "audit.view",
  "system.manage_jobs",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_SET: ReadonlySet<Permission> = new Set(PERMISSIONS);

/* ────────────────────────────────────────────── the matrix */

/**
 * Roles → permissions. Every role in `STAFF_ROLES` must appear exactly once;
 * `assertMatrixIsComplete()` below enforces that, and a unit test calls it, so
 * adding a role to the enum without deciding its permissions fails the build
 * gate rather than silently granting nothing.
 *
 * `super_admin` is listed explicitly rather than short-circuited in
 * `hasPermission`. A wildcard would be one `if` away from becoming the
 * `isAdmin` boolean §77 rules out, and an explicit list means the audit can see
 * exactly what the role holds.
 */
export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = {
  super_admin: PERMISSIONS,

  /* Front line. Sees everything customer-facing, changes almost nothing —
     specifically no pricing, no refunds, no publishing. */
  customer_service: [
    "customer.view_all",
    "request.view_all",
    "request.update_status",
    "request.comment_internal",
    "order.view_all",
    "quote.view_all",
    "invoice.view_all",
    "payment.view_all",
    "message.view_all",
    "message.reply_customer",
    "product.view_all",
  ],

  sales: [
    "customer.view_all",
    "customer.update",
    "request.view_all",
    "request.assign",
    "request.update_status",
    "request.comment_internal",
    "quote.view_all",
    "quote.draft",
    "quote.issue",
    "quote.revise",
    "quote.withdraw",
    "order.view_all",
    "invoice.view_all",
    "message.view_all",
    "message.reply_customer",
    "product.view_all",
    "product.manage_pricing",
  ],

  /* Scopes the work and writes the technical half of a quote. Cannot issue it —
     issuing is a commercial commitment (§21). */
  technical_analyst: [
    "request.view_all",
    "request.assign",
    "request.update_status",
    "request.comment_internal",
    "quote.view_all",
    "quote.draft",
    "product.view_all",
    "project.view_all",
    "message.view_all",
    "customer.view_all",
  ],

  developer: [
    "product.view_all",
    "product.create",
    "product.update",
    "product.manage_files",
    "request.view_all",
    "request.comment_internal",
    "project.view_all",
    "project.update_milestone",
  ],

  project_manager: [
    "customer.view_all",
    "request.view_all",
    "request.assign",
    "request.update_status",
    "request.comment_internal",
    "request.close",
    "project.view_all",
    "project.manage",
    "project.update_milestone",
    "order.view_all",
    "order.update_status",
    "message.view_all",
    "message.reply_customer",
    "quote.view_all",
  ],

  support_agent: [
    "customer.view_all",
    "request.view_all",
    "request.comment_internal",
    "message.view_all",
    "message.reply_customer",
    "order.view_all",
    "product.view_all",
  ],

  /* Owns the storefront: what is listed, at what price, and whether it is
     live. The ticket's own acceptance criterion turns on this row. */
  marketplace_manager: [
    "product.view_all",
    "product.create",
    "product.update",
    "product.publish",
    "product.unpublish",
    "product.delete",
    "product.manage_files",
    "product.manage_pricing",
    "taxonomy.manage",
    "order.view_all",
    // Whoever decides what a product costs decides what a promotion takes off
    // it. Keeping these together is what makes the pricing story one job.
    "discount.manage",
  ],

  finance: [
    "payment.view_all",
    "payment.refund",
    "payment.reconcile",
    "payment.record_manual",
    "invoice.view_all",
    "invoice.issue",
    "invoice.void",
    "order.view_all",
    "order.cancel",
    "quote.view_all",
    "customer.view_all",
    // Tax is a finance decision. Discounts are a commercial one — see
    // `marketplace_manager` — and finance does not get to invent them.
    "tax.manage",
  ],

  devops: ["system.manage_jobs", "audit.view", "settings.manage", "product.view_all"],

  content_manager: ["product.view_all", "product.update", "taxonomy.manage"],
};

/* ────────────────────────────────────────────── resolution */

/**
 * Effective permissions for a set of roles — the union, deduplicated.
 *
 * Unknown role strings are ignored rather than throwing: a role removed from
 * the enum while a `staffProfiles` document still carries it should quietly
 * grant nothing, not lock the person out of the platform with a 500.
 */
export function permissionsForRoles(roles: readonly string[]): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    const permissions = ROLE_PERMISSIONS[role as StaffRole];
    if (!permissions) continue;
    for (const permission of permissions) granted.add(permission);
  }
  return granted;
}

export function hasPermission(
  granted: ReadonlySet<Permission>,
  permission: Permission,
): boolean {
  return granted.has(permission);
}

/** True only if every one of `required` is held. */
export function hasAllPermissions(
  granted: ReadonlySet<Permission>,
  required: readonly Permission[],
): boolean {
  return required.every((p) => granted.has(p));
}

export function hasAnyPermission(
  granted: ReadonlySet<Permission>,
  required: readonly Permission[],
): boolean {
  return required.some((p) => granted.has(p));
}

/* ────────────────────────────────────────────── invariants */

/**
 * Called by a unit test. Catches the two ways this matrix rots:
 * a role added to the enum but not given permissions, and a typo'd permission
 * string that TypeScript would allow if the array were ever widened.
 */
export function assertMatrixIsComplete(): void {
  const missing = STAFF_ROLES.filter((role) => !(role in ROLE_PERMISSIONS));
  if (missing.length > 0) {
    throw new Error(
      `ROLE_PERMISSIONS is missing entries for: ${missing.join(", ")}. ` +
        `Every staff role must have its permissions decided explicitly.`,
    );
  }

  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of permissions) {
      if (!PERMISSION_SET.has(permission)) {
        throw new Error(`Role "${role}" grants unknown permission "${permission}".`);
      }
    }
  }
}
