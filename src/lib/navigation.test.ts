import { describe, expect, it } from "vitest";
import { ORGANIZATION_ROLES, STAFF_ROLES } from "@/lib/db/enums";
import { permissionsForRoles, type Permission } from "@/lib/auth/permissions";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import {
  ADMIN_NAV,
  ADMIN_PERMISSIONS,
  CUSTOMER_NAV,
  DEFERRED_MODULES,
  STAFF_NAV,
  adminNavFor,
  adminShellNavFor,
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

  /**
   * Vendor ticket 01. Being a vendor is orthogonal to an organisation role, so the vendor
   * workspace must appear for a vendor in *every* role and for a non-vendor in none — including
   * `owner`, whose organisation role says nothing about whether they sell here.
   */
  it("draws the vendor workspace only for a vendor, whatever their organisation role", () => {
    for (const role of ORGANIZATION_ROLES) {
      const asCustomer = customerNavFor(role).flatMap((s) => s.items.map((i) => i.href));
      expect(asCustomer, `role: ${role}`).not.toContain("/dashboard/selling");

      const asVendor = customerNavFor(role, { isVendor: true }).flatMap((s) =>
        s.items.map((i) => i.href),
      );
      expect(asVendor, `role: ${role}`).toContain("/dashboard/selling");
      // And the screens below it, which is the change: nine items behind one link was a second
      // navigation nobody could see until they were already inside the section.
      expect(asVendor, `role: ${role}`).toContain("/dashboard/selling/earnings");
      expect(asVendor, `role: ${role}`).toContain("/dashboard/selling/support");
    }
  });

  /**
   * The **entry point**, which is the thing that was missing entirely.
   *
   * `/sell` explained selling well and was linked from nowhere — not the nav, not the footer, not
   * the sitemap — while the only screen offering "Apply to sell" required already being a vendor.
   * A door that works and has nothing leading to it is the same as no door.
   */
  it("offers a non-vendor the way in, and withdraws it once they are one", () => {
    for (const role of ORGANIZATION_ROLES) {
      const asCustomer = customerNavFor(role).flatMap((s) => s.items.map((i) => i.href));
      expect(asCustomer, `role: ${role}`).toContain("/sell");

      const asVendor = customerNavFor(role, { isVendor: true }).flatMap((s) =>
        s.items.map((i) => i.href),
      );
      // Gone once they are through it: by then it points at a page they have read.
      expect(asVendor, `role: ${role}`).not.toContain("/sell");
    }
  });

  /**
   * Owner-only, and the one capability the two-role model exists to separate: vendor settings
   * holds the payout account. A `member` shown this link would reach a 403.
   */
  it("shows vendor settings to an owner and not to a member", () => {
    const asMember = customerNavFor("owner", { isVendor: true }).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(asMember).not.toContain("/dashboard/selling/settings");

    const asOwner = customerNavFor("owner", {
      isVendor: true,
      isVendorOwner: true,
    }).flatMap((s) => s.items.map((i) => i.href));
    expect(asOwner).toContain("/dashboard/selling/settings");
  });

  /**
   * The section never disappears now, because the entry point lives in it — but its *contents*
   * change completely. A non-vendor gets one item; a vendor gets the workspace and not the teaser.
   */
  it("keeps the Vendor section for everybody but changes what is in it", () => {
    const asCustomer = customerNavFor("owner").find((s) => s.title === "Vendor");
    expect(asCustomer?.items).toHaveLength(1);
    expect(asCustomer?.items[0]?.href).toBe("/sell");

    const asVendor = customerNavFor("owner", { isVendor: true }).find(
      (s) => s.title === "Vendor",
    );
    expect(asVendor?.items.length ?? 0).toBeGreaterThan(1);
  });

  /**
   * Team is a route that exists and is deliberately unlinked from the navigation:
   * a one-person vendor must not be walked through a team model to sell one script.
   * It is reachable from vendor settings and nowhere else.
   */
  it("keeps the vendor team screen out of the navigation", () => {
    const hrefs = customerNavFor("owner", { isVendor: true }).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(hrefs).not.toContain("/dashboard/selling/team");
  });

  it("offers no organization settings, to anyone, while the screen is a stub", () => {
    /*
     * This used to assert the opposite — visible to owners and admins — and the
     * screen behind it renders a hardcoded "nothing to manage yet" with no
     * query at all. It says that however many members the organisation has, so
     * every one of those clicks was wasted.
     *
     * The route is deliberately still there: it must not 404, and the eventual
     * ticket needs somewhere to land. Restore the nav entry in the same commit
     * that gives it members, roles and billing details to show.
     */
    for (const role of ORGANIZATION_ROLES) {
      const labels = customerNavFor(role).flatMap((s) => s.items.map((i) => i.label));
      expect(labels, `role: ${role}`).not.toContain("Organization");
    }
  });

  it("offers the admin area to staff who can reach it, and to nobody else", () => {
    /*
     * There was no path at all from `/staff` to `/admin`: neither table had an
     * entry for the other, and the only cross-link lived in the avatar dropdown
     * — where, at `/staff`, it pointed back at `/staff`.
     *
     * Gated on `ADMIN_PERMISSIONS`, which is what `app/admin/layout.tsx` uses
     * as its own gate, so the link appears exactly when the destination would
     * admit the visitor. A link that leads to a refusal is worse than no link.
     */
    const superAdmin = new Set(ADMIN_PERMISSIONS);
    const staffLabels = staffNavFor(superAdmin).flatMap((s) => s.items.map((i) => i.label));
    expect(staffLabels).toContain("Admin");

    const supportOnly = new Set<Permission>(["request.view_all"]);
    const supportLabels = staffNavFor(supportOnly).flatMap((s) => s.items.map((i) => i.label));
    expect(supportLabels).not.toContain("Admin");
    expect(supportLabels.length).toBeGreaterThan(0);
  });

  it("offers the way back to the staff console from admin", () => {
    const adminLabels = adminShellNavFor(new Set(ADMIN_PERMISSIONS)).flatMap((s) =>
      s.items.map((i) => i.label),
    );
    expect(adminLabels).toContain("Staff console");

    // And nothing at all — not even the way out — for somebody the admin
    // layout would turn away. `adminNavFor` being empty is what it reads.
    expect(adminShellNavFor(new Set<Permission>(["request.view_all"]))).toHaveLength(0);
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
