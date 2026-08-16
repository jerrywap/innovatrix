import { describe, expect, it } from "vitest";
import { ORGANIZATION_ROLES, STAFF_ROLES } from "@/lib/db/enums";
import { organizationRoles } from "./organization-access";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  assertMatrixIsComplete,
  hasAllPermissions,
  hasAnyPermission,
  permissionsForRoles,
} from "./permissions";

describe("staff permission matrix — §77", () => {
  it("covers every staff role and grants no unknown permission", () => {
    // The whole point of the assertion living in the module is that this test
    // is one line and can never drift from it.
    expect(() => assertMatrixIsComplete()).not.toThrow();
  });

  it("has no duplicate permissions in the catalogue", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  /** The ticket's acceptance criterion, verbatim. */
  it("denies customer_service product.publish and allows marketplace_manager", () => {
    expect(permissionsForRoles(["customer_service"]).has("product.publish")).toBe(false);
    expect(permissionsForRoles(["marketplace_manager"]).has("product.publish")).toBe(true);
  });

  it("keeps refunds to finance and super_admin only", () => {
    const canRefund = STAFF_ROLES.filter((role) =>
      permissionsForRoles([role]).has("payment.refund"),
    );
    expect(canRefund.sort()).toEqual(["finance", "super_admin"]);
  });

  it("keeps staff.manage and payment_provider.configure to super_admin only", () => {
    for (const permission of ["staff.manage", "payment_provider.configure"] as const) {
      const holders = STAFF_ROLES.filter((role) => permissionsForRoles([role]).has(permission));
      expect(holders).toEqual(["super_admin"]);
    }
  });

  it("unions permissions across roles rather than taking the strongest", () => {
    const combined = permissionsForRoles(["content_manager", "finance"]);
    // From content_manager…
    expect(combined.has("taxonomy.manage")).toBe(true);
    // …and from finance, with neither containing the other.
    expect(combined.has("payment.refund")).toBe(true);
    // Neither role grants publishing, so the union must not either.
    expect(combined.has("product.publish")).toBe(false);
  });

  it("grants nothing for an unknown or empty role list", () => {
    expect(permissionsForRoles([]).size).toBe(0);
    // A role removed from the enum while a document still carries it must fail
    // closed, not throw and lock the person out with a 500.
    expect(permissionsForRoles(["ceo_of_everything"]).size).toBe(0);
  });

  it("gives super_admin the whole catalogue", () => {
    expect(permissionsForRoles(["super_admin"]).size).toBe(PERMISSIONS.length);
  });

  /**
   * §77's actual requirement: no role is a boolean shortcut. If a non-admin
   * role ever held every permission, `isAdmin` would have been reinvented.
   */
  it("has no role other than super_admin holding everything", () => {
    for (const role of STAFF_ROLES) {
      if (role === "super_admin") continue;
      expect(permissionsForRoles([role]).size).toBeLessThan(PERMISSIONS.length);
    }
  });

  it("checks all-of and any-of correctly", () => {
    const granted = permissionsForRoles(["sales"]);
    expect(hasAllPermissions(granted, ["quote.issue", "quote.draft"])).toBe(true);
    expect(hasAllPermissions(granted, ["quote.issue", "payment.refund"])).toBe(false);
    expect(hasAnyPermission(granted, ["payment.refund", "quote.issue"])).toBe(true);
    expect(hasAnyPermission(granted, ["payment.refund", "staff.manage"])).toBe(false);
  });

  it("gives every role at least one permission", () => {
    for (const role of STAFF_ROLES) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });
});

/**
 * `newRole` returns an exact type, so `role.statements.delivery` on a role that
 * doesn't grant `delivery` is a *compile* error — which is a stronger guarantee
 * than the assertions below, but only holds for code that reads the constant
 * directly. Widening here keeps the runtime check meaningful: it would still
 * catch a future refactor that builds these roles dynamically.
 */
function statementsOf(role: {
  statements: Record<string, readonly string[] | undefined>;
}): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(role.statements)) {
    if (value) out[key] = value;
  }
  return out;
}

describe("organization access control — §76", () => {
  /**
   * A role present in the database but absent from this map resolves to no
   * permissions at runtime, which looks like a mysterious permission bug
   * rather than a missing definition.
   */
  it("defines exactly the roles the database enum allows", () => {
    expect(Object.keys(organizationRoles).sort()).toEqual([...ORGANIZATION_ROLES].sort());
  });

  it("separates money from deliverables", () => {
    // §88, least privilege: the finance contact pays, the engineer receives.
    const billing = statementsOf(organizationRoles.billing);
    const technical = statementsOf(organizationRoles.technical);

    expect(billing.billing).toContain("manage");
    expect(billing.delivery ?? []).not.toContain("download");

    expect(technical.delivery).toContain("download");
    expect(technical.billing ?? []).not.toContain("view");
  });

  it("lets only the owner delete the organization", () => {
    expect(statementsOf(organizationRoles.owner).organization).toContain("delete");
    for (const role of ["admin", "billing", "technical", "member"] as const) {
      expect(statementsOf(organizationRoles[role]).organization ?? []).not.toContain("delete");
    }
  });

  it("keeps member from spending money", () => {
    const member = statementsOf(organizationRoles.member);
    expect(member.order ?? []).not.toContain("create");
    expect(member.billing ?? []).toHaveLength(0);
  });
});
