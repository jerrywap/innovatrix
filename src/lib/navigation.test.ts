import { describe, expect, it } from "vitest";
import { ORGANIZATION_ROLES, STAFF_ROLES } from "@/lib/db/enums";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import {
  ADMIN_NAV,
  ADMIN_PERMISSIONS,
  CUSTOMER_NAV,
  DEFERRED_MODULES,
  STAFF_NAV,
  adminNavFor,
  allNavItems,
  customerNavFor,
  isActive,
  permissionsFor,
  staffNavFor,
} from "./navigation";

describe("navigation is filtered, not decorative", () => {
  it("hides staff items whose permission the user lacks", () => {
    const support = permissionsForRoles(["support_agent"]);
    const labels = staffNavFor(support).flatMap((s) => s.items.map((i) => i.label));

    expect(labels).toContain("Customers");
    // support_agent has no quote.view_all.
    expect(labels).not.toContain("Quotes");
  });

  it("drops a section once every item in it is filtered away", () => {
    // content_manager holds only catalogue permissions, so Commerce and
    // Platform must not render as empty headings.
    const contentManager = permissionsForRoles(["content_manager"]);
    const sections = adminNavFor(contentManager);

    expect(sections.every((section) => section.items.length > 0)).toBe(true);
    expect(sections.map((s) => s.title)).not.toContain("Commerce");
  });

  it("gives super_admin everything and a bare role almost nothing", () => {
    const everything = permissionsForRoles(["super_admin"]);
    const nothing = permissionsForRoles([]);

    const all = adminNavFor(everything).flatMap((s) => s.items).length;
    expect(all).toBe(ADMIN_NAV.flatMap((s) => s.items).length);
    expect(adminNavFor(nothing)).toHaveLength(0);
  });

  /**
   * §88, least privilege — the same split enforced in `organization-access.ts`,
   * asserted here so the nav can't quietly contradict it.
   */
  it("keeps invoices from the technical contact and deliverables from billing", () => {
    const billingLabels = customerNavFor("billing").flatMap((s) => s.items.map((i) => i.label));
    const technicalLabels = customerNavFor("technical").flatMap((s) =>
      s.items.map((i) => i.label),
    );

    expect(billingLabels).toContain("Invoices");
    expect(billingLabels).not.toContain("My software");

    expect(technicalLabels).toContain("My software");
    expect(technicalLabels).not.toContain("Invoices");
  });

  it("shows organization settings only to owners and admins", () => {
    for (const role of ORGANIZATION_ROLES) {
      const labels = customerNavFor(role).flatMap((s) => s.items.map((i) => i.label));
      const expected = role === "owner" || role === "admin";
      expect(labels.includes("Organization"), `role: ${role}`).toBe(expected);
    }
  });

  it("gives every organization role a usable dashboard", () => {
    // A role that filters down to nothing would render an empty sidebar, which
    // reads as a broken account rather than a restricted one.
    for (const role of ORGANIZATION_ROLES) {
      expect(customerNavFor(role).length, `role: ${role}`).toBeGreaterThan(0);
    }
  });
});

describe("deferred modules appear nowhere", () => {
  /**
   * `typedRoutes` already makes a link to an unbuilt route a compile error.
   * This catches the case it cannot: someone later builds `/dashboard/projects`
   * for an unrelated reason, and the dead link quietly becomes legal.
   */
  it("has no nav item pointing at a post-MVP module", () => {
    const offenders = allNavItems().filter((item) =>
      DEFERRED_MODULES.some(
        (slug) => item.href === `/${slug}` || item.href.includes(`/${slug}`),
      ),
    );

    expect(
      offenders.map((o) => `${o.label} → ${o.href}`),
      "post-MVP modules must not be linked",
    ).toEqual([]);
  });

  it("mentions none of them by label either", () => {
    const labels = allNavItems().map((item) => item.label.toLowerCase());
    for (const slug of ["projects", "tickets", "subscriptions", "renewals"]) {
      expect(labels).not.toContain(slug);
    }
  });
});

describe("ADMIN_PERMISSIONS", () => {
  it("is derived from the nav, so entry and visibility cannot disagree", () => {
    const fromNav = [
      ...new Set(ADMIN_NAV.flatMap((section) => section.items.flatMap(permissionsFor))),
    ];
    expect([...ADMIN_PERMISSIONS].sort()).toEqual(fromNav.sort());
  });

  /** An item can accept several permissions; any one of them opens it. */
  it("admits finance to the admin Orders screen via order.cancel", () => {
    const finance = permissionsForRoles(["finance"]);
    expect(finance.has("order.update_status")).toBe(false);
    expect(finance.has("order.cancel")).toBe(true);

    const labels = adminNavFor(finance).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain("Orders");
  });

  it("admits every role that can see an admin screen, and no others", () => {
    for (const role of STAFF_ROLES) {
      const permissions = permissionsForRoles([role]);
      const admitted = ADMIN_PERMISSIONS.some((p) => permissions.has(p));
      const seesSomething = adminNavFor(permissions).length > 0;
      expect(admitted, `role: ${role}`).toBe(seesSomething);
    }
  });

  /**
   * The reason admin screens are gated on management permissions rather than
   * view permissions. `customer_service` legitimately holds `product.view_all`
   * and `order.view_all` — they need to see the catalogue and a customer's
   * orders to answer a call — and gating on those let them into the catalogue
   * *management* area.
   */
  it("keeps purely customer-facing roles out of admin entirely", () => {
    for (const role of [
      "customer_service",
      "support_agent",
      "sales",
      "technical_analyst",
    ] as const) {
      const permissions = permissionsForRoles([role]);
      expect(
        ADMIN_PERMISSIONS.some((p) => permissions.has(p)),
        `${role} must not reach the admin area`,
      ).toBe(false);
      expect(adminNavFor(permissions)).toHaveLength(0);
    }
  });

  it("still lets those roles see what they need in the staff console", () => {
    const cs = permissionsForRoles(["customer_service"]);
    // The capability was never removed — only the door it opened.
    expect(cs.has("product.view_all")).toBe(true);
    expect(cs.has("order.view_all")).toBe(true);
    expect(staffNavFor(cs).length).toBeGreaterThan(0);
  });

  it("admits the roles that actually manage the platform", () => {
    for (const role of ["marketplace_manager", "finance", "devops", "super_admin"] as const) {
      expect(adminNavFor(permissionsForRoles([role])).length, role).toBeGreaterThan(0);
    }
  });
});

describe("isActive", () => {
  const orders = CUSTOMER_NAV.flatMap((s) => s.items).find((i) => i.label === "Orders")!;
  const notifications = CUSTOMER_NAV.flatMap((s) => s.items).find(
    (i) => i.label === "Notifications",
  )!;

  it("matches exactly", () => {
    expect(isActive(orders, "/dashboard/orders")).toBe(true);
    expect(isActive(orders, "/dashboard")).toBe(false);
  });

  it("matches children when the item opts in", () => {
    expect(isActive(orders, "/dashboard/orders/ORD-2026-0148")).toBe(true);
    expect(isActive(notifications, "/dashboard/notifications/anything")).toBe(false);
  });

  /** The trailing slash is what stops a sibling route lighting up. */
  it("does not match a sibling route with a shared prefix", () => {
    expect(isActive(orders, "/dashboard/orders-archive")).toBe(false);
  });
});

describe("nav shape", () => {
  it("has no duplicate hrefs within a surface", () => {
    for (const [name, nav] of [
      ["customer", CUSTOMER_NAV],
      ["staff", STAFF_NAV],
      ["admin", ADMIN_NAV],
    ] as const) {
      const hrefs = nav.flatMap((s) => s.items.map((i) => i.href));
      expect(new Set(hrefs).size, `${name} nav has a duplicate href`).toBe(hrefs.length);
    }
  });

  it("gives every item a label and an icon", () => {
    for (const item of allNavItems()) {
      expect(item.label.length).toBeGreaterThan(0);
      // A *name*, resolved to a component on the client — see nav-icons.ts.
      expect(item.icon).toBeTypeOf("string");
      expect(item.icon in NAV_ICONS, `unknown icon "${item.icon}"`).toBe(true);
    }
  });
});
