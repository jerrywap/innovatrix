import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Organization access control — §76.
 *
 * This governs what a **customer** may do inside **their own** organization:
 * invite colleagues, change billing details, remove a member. It is enforced by
 * Better Auth's organization plugin.
 *
 * It is *not* the staff permission matrix. See `permissions.ts` — that one
 * governs what Innovatrix staff may do across the platform. The two systems are
 * kept separate on purpose:
 *
 * - They answer different questions ("may this customer invite someone to their
 *   own org?" vs "may this employee refund a payment?").
 * - They have different blast radii. A mistake here affects one organization; a
 *   mistake there affects every customer.
 * - Better Auth owns one and we own the other. Merging them would mean either
 *   pushing staff roles into a plugin that has no concept of them, or
 *   reimplementing invitation authorization ourselves.
 *
 * Better Auth ships only `owner`, `admin` and `member`. §76 requires `billing`
 * and `technical` as well, which is what the access control below is for.
 */

/**
 * `defaultStatements` supplies `organization`, `member`, `invitation`, `team`
 * and `ac`. We extend it with the resources a customer organization actually
 * owns in this product, so a role can be expressed in one place rather than as
 * scattered `if (role === …)` checks.
 */
export const organizationStatements = {
  ...defaultStatements,
  /** Billing details, payment methods, invoices. */
  billing: ["view", "manage"],
  /** Orders placed by the organization, and their downloads. */
  order: ["view", "create", "cancel"],
  /** Custom software requests raised by the organization. */
  request: ["view", "create", "update", "close"],
  /** Delivered artefacts, licence keys, deployment credentials (§89). */
  delivery: ["view", "download"],
} as const;

export const organizationAc = createAccessControl(organizationStatements);

/* ────────────────────────────────────────────── roles

   Ordered most-privileged first. Note none of these can be granted across
   organizations: Better Auth resolves a role from the caller's *membership*,
   so a role is always evaluated against a specific organization.            */

/** Full control, including deleting the organization and transferring it. */
export const ownerRole = organizationAc.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  ac: ["create", "read", "update", "delete"],
  billing: ["view", "manage"],
  order: ["view", "create", "cancel"],
  request: ["view", "create", "update", "close"],
  delivery: ["view", "download"],
});

/** Everything an owner can do except delete the organization itself. */
export const adminRole = organizationAc.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  ac: ["read"],
  billing: ["view", "manage"],
  order: ["view", "create", "cancel"],
  request: ["view", "create", "update", "close"],
  delivery: ["view", "download"],
});

/**
 * Finance contact. Sees and manages money, and may place orders — but cannot
 * touch membership, and deliberately cannot download deliverables: paying for
 * software is not the same job as receiving it.
 */
export const billingRole = organizationAc.newRole({
  billing: ["view", "manage"],
  order: ["view", "create", "cancel"],
  request: ["view"],
  ac: ["read"],
});

/**
 * The engineer who actually receives the software. Full access to deliverables
 * and requests, no access to billing at all — invoices and card details are not
 * their business (§88, least privilege).
 */
export const technicalRole = organizationAc.newRole({
  order: ["view"],
  request: ["view", "create", "update", "close"],
  delivery: ["view", "download"],
  ac: ["read"],
});

/** Baseline. Can see the organization's work and raise a request; buys nothing. */
export const memberRole = organizationAc.newRole({
  order: ["view"],
  request: ["view", "create"],
  delivery: ["view"],
  ac: ["read"],
});

/**
 * Keys must match `ORGANIZATION_ROLES` in `src/lib/db/enums.ts`; a unit test
 * asserts that, because a mismatch means a role that exists in the database
 * resolves to no permissions at runtime.
 */
export const organizationRoles = {
  owner: ownerRole,
  admin: adminRole,
  billing: billingRole,
  technical: technicalRole,
  member: memberRole,
};
