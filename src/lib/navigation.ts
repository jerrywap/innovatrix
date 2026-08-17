import type { Route } from "next";
import type { NavIconName } from "@/components/shell/nav-icons";
import type { OrganizationRole } from "@/lib/db/enums";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Navigation — §4 (four surfaces), §28 (customer nav), §77 (permissions).
 *
 * Pure data plus pure filters. No database access and no request context, so
 * this module is unit-testable and callable from any layout.
 *
 * ## Navigation is not authorization
 *
 * `visibleTo` decides what is *drawn*. It does not decide what is *allowed* —
 * that is the DAL, on every request, in the page and in the server action
 * behind it. A hidden nav item must also be a refused request, and the reverse
 * mistake is the dangerous one: filtering the nav and then forgetting the
 * `requirePermission()` call leaves a screen that anyone can reach by typing
 * the URL.
 *
 * ## Why `href` is typed as `Route`
 *
 * `typedRoutes` is enabled, so a route that does not exist is a **compile
 * error** here. That is the mechanism behind this ticket's "deferred modules
 * appear nowhere in navigation": a link to `/projects` cannot be added until
 * somebody builds `/projects`, by which point it is no longer deferred.
 * `DEFERRED_MODULES` below is the belt to that braces.
 */

export interface NavItem {
  label: string;
  href: Route;
  /**
   * A *name*, not a component. The nav is built on the server and consumed by
   * a Client Component, and React refuses to pass a component function across
   * that boundary — see `nav-icons.ts`.
   */
  icon: NavIconName;
  /**
   * Staff and admin only. Absent ⇒ visible to anyone in that shell.
   *
   * A list means **any of them** is enough. Screens rarely map to exactly one
   * permission: the admin Orders screen is reachable by someone who changes an
   * order's status *or* by someone who cancels one, and those are different
   * roles doing different jobs at the same table.
   */
  permission?: Permission | readonly Permission[];
  /** Customer only. Absent ⇒ visible to every member of the organization. */
  organizationRoles?: readonly OrganizationRole[];
  /**
   * Customer shell only. Drawn only for a user who is also a vendor — vendor
   * ticket 01.
   *
   * A third predicate rather than a value in `organizationRoles`, because being a
   * vendor is orthogonal to an organisation role: the same person is a buyer with
   * a role *and* a seller, and folding one into the other would make
   * `role: "owner"` mean two things.
   */
  requiresVendor?: true;
  /** Matches child routes too — `/dashboard/orders/ORD-1` highlights Orders. */
  matchNested?: boolean;
}

export interface NavSection {
  title?: string;
  items: readonly NavItem[];
}

/* ────────────────────────────────────────────── customer (§28) */

/**
 * The MVP subset. §28 lists more; everything absent here is deferred (see
 * `DEFERRED_MODULES`) and deliberately has no route to link to.
 *
 * Role gating follows the least-privilege split in `organization-access.ts`:
 * the billing contact sees money and not deliverables, the technical contact
 * sees deliverables and not money.
 */
export const CUSTOMER_NAV: readonly NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
      { label: "Marketplace", href: "/marketplace", icon: "store" },
    ],
  },
  {
    title: "Your software",
    items: [
      {
        label: "My software",
        href: "/dashboard/software",
        icon: "package",
        matchNested: true,
        // §89: deliverables and licence keys. Not the billing contact's job.
        organizationRoles: ["owner", "admin", "technical", "member"],
      },
      {
        label: "Orders",
        href: "/dashboard/orders",
        icon: "bag",
        matchNested: true,
      },
      {
        label: "Saved",
        href: "/dashboard/saved",
        icon: "bookmark",
        // No `organizationRoles`: a bookmark belongs to the person, not the
        // organisation, so every member sees their own list.
      },
    ],
  },
  {
    title: "Custom work",
    items: [
      {
        label: "Requests",
        href: "/dashboard/requests",
        icon: "clipboard",
        matchNested: true,
      },
      { label: "Quotes", href: "/dashboard/quotes", icon: "file", matchNested: true },
    ],
  },
  {
    /*
     * Vendor ticket 01. Drawn only for a user who has a vendor, which is why the
     * whole section disappears rather than showing a "become a vendor" teaser:
     * `prune` drops a section once its last item goes, and the marketplace's own
     * footer is where somebody discovers they could sell here.
     *
     * One item, not four. Products, earnings and the storefront belong in this
     * group and arrive with vendor tickets 04, 08 and 11 — `typedRoutes` will not
     * compile a link to a route nobody has built, which is the rule doing its job.
     *
     * Team is deliberately absent even though the route exists: a one-person
     * vendor must not be walked through a team model, so it lives behind Settings.
     */
    title: "Selling",
    items: [
      {
        label: "Selling",
        href: "/dashboard/selling",
        icon: "store",
        matchNested: true,
        requiresVendor: true,
      },
    ],
  },
  {
    title: "Billing",
    items: [
      {
        label: "Invoices",
        href: "/dashboard/invoices",
        icon: "receipt",
        matchNested: true,
        organizationRoles: ["owner", "admin", "billing"],
      },
    ],
  },
  {
    items: [
      {
        label: "Messages",
        href: "/dashboard/messages",
        icon: "messages",
        matchNested: true,
      },
      { label: "Notifications", href: "/dashboard/notifications", icon: "bell" },
    ],
  },
  {
    title: "Settings",
    items: [
      /*
       * `Organization` is not here, and the route still exists.
       *
       * `/dashboard/organization` renders a hardcoded empty state with no query
       * behind it — it will say "nothing to manage yet" however many members an
       * organisation has. A nav entry is a promise; this one costs a click and
       * teaches the customer the product is unfinished. It goes back the moment
       * tickets 03/24 give it members, roles and billing details to show.
       */
      { label: "Account", href: "/dashboard/account", icon: "userCog" },
    ],
  },
];

/* ────────────────────────────────────────────── crossing between portals */

/**
 * The way out of a portal, for somebody who belongs in both.
 *
 * There was none. `STAFF_NAV` had no `/admin` entry and `ADMIN_NAV` had no
 * `/staff` entry, and the only cross-link anywhere was buried in the avatar
 * dropdown — where, at `/staff`, it linked to `/staff`. A super-admin moving
 * between the two consoles had to type the URL.
 *
 * ## Gated on the destination's own entry condition
 *
 * `ADMIN_PERMISSIONS` is derived from `ADMIN_NAV` and is what
 * `app/admin/layout.tsx` uses as its gate, so a link gated on the same set is
 * offered exactly when the destination would admit the visitor. `permitted()`
 * treats a list as OR, which is the same semantics the layout applies. Defined
 * as a `get` rather than a const because `ADMIN_PERMISSIONS` is declared below
 * — and it must stay derived, or the link and the gate drift apart.
 *
 * A separate section rather than an item among the queues: this is leaving,
 * not another place to work.
 */
const TO_ADMIN: NavSection = {
  title: "Elsewhere",
  items: [{ label: "Admin", href: "/admin", icon: "settings" }],
};

const TO_STAFF: NavSection = {
  title: "Elsewhere",
  items: [{ label: "Staff console", href: "/staff", icon: "inbox" }],
};

/* ────────────────────────────────────────────── staff (§77) */

/**
 * Queues first, because that is the job. A staff member opens this to find out
 * what is waiting for them, not to browse.
 */
export const STAFF_NAV: readonly NavSection[] = [
  {
    items: [
      { label: "Queues", href: "/staff", icon: "inbox" },
      {
        label: "Requests",
        href: "/staff/requests",
        icon: "clipboard",
        permission: "request.view_all",
        matchNested: true,
      },
      {
        label: "Quotes",
        href: "/staff/quotes",
        icon: "file",
        permission: "quote.view_all",
        matchNested: true,
      },
      {
        label: "Invoices",
        href: "/staff/invoices",
        icon: "receipt",
        permission: "invoice.view_all",
        matchNested: true,
      },
      {
        label: "Customers",
        href: "/staff/customers",
        icon: "users",
        permission: "customer.view_all",
        matchNested: true,
      },
      {
        /*
         * Vendor ticket 01. In `STAFF_NAV` rather than `ADMIN_NAV` deliberately:
         * `ADMIN_PERMISSIONS` is derived from `ADMIN_NAV`, and
         * `navigation.test.ts` asserts that four purely customer-facing roles
         * reach *zero* admin nav items. Reviewing an application is staff work,
         * not platform administration, so putting it here keeps that assertion
         * meaningful instead of making it something to work around.
         */
        label: "Vendors",
        href: "/staff/vendor-applications",
        icon: "building",
        permission: ["vendor.review", "vendor.verify"],
        matchNested: true,
      },
      {
        // Vendor ticket 05. Its own item rather than a tab under Vendors: deciding
        // *who may sell* and deciding *what goes on sale* are different jobs held by
        // different permissions, and `finance` holds the first without the second.
        label: "Submissions",
        href: "/staff/vendor-submissions",
        icon: "checklist",
        permission: "product.review",
        matchNested: true,
      },
    ],
  },
  {
    title: "Working",
    items: [
      {
        label: "Follow-ups",
        href: "/staff/follow-ups",
        icon: "timer",
        permission: "request.view_all",
      },
      {
        label: "Messages",
        href: "/staff/messages",
        icon: "messages",
        permission: "message.view_all",
        matchNested: true,
      },
      {
        // No permission: everybody who works here has an inbox, and it holds
        // only what they were already entitled to be told.
        label: "Notifications",
        href: "/staff/notifications",
        icon: "bell",
      },
    ],
  },
];

/* ────────────────────────────────────────────── admin */

/**
 * Admin screens are gated on the permission their **primary action** needs, not
 * on the permission to *look*.
 *
 * The distinction is load-bearing and was got wrong first time round. Gating
 * `/admin/products` on `product.view_all` let a `customer_service` agent — who
 * legitimately needs to see every product to help a caller — walk into the
 * catalogue management area. Viewing belongs to the staff console; changing
 * belongs here. `ADMIN_PERMISSIONS` is derived from this list, so the entry
 * gate moved with it.
 */
export const ADMIN_NAV: readonly NavSection[] = [
  {
    title: "Catalogue",
    items: [
      {
        label: "Products",
        href: "/admin/products",
        icon: "package",
        permission: "product.update",
        matchNested: true,
      },
      {
        label: "Taxonomies",
        href: "/admin/taxonomies",
        icon: "tags",
        permission: "taxonomy.manage",
      },
    ],
  },
  {
    title: "Commerce",
    items: [
      {
        label: "Orders",
        href: "/admin/orders",
        icon: "bag",
        // Two jobs meet at this table: operations moving an order along, and
        // finance cancelling one. Gating on either alone locked the other out.
        permission: ["order.update_status", "order.cancel"],
        matchNested: true,
      },
      {
        label: "Payments",
        href: "/admin/payments",
        icon: "card",
        permission: "payment.reconcile",
        matchNested: true,
      },
      {
        label: "Discounts",
        href: "/admin/discounts",
        icon: "tags",
        permission: "discount.manage",
      },
    ],
  },
  {
    title: "Platform",
    items: [
      {
        label: "Users & roles",
        href: "/admin/users",
        icon: "userCog",
        permission: "staff.manage",
      },
      {
        label: "Jobs",
        href: "/admin/jobs",
        icon: "checklist",
        permission: "system.manage_jobs",
      },
      {
        // Narrow on purpose: the log records staff actions too, so reading it
        // is its own capability rather than something every admin has (§90).
        label: "Audit log",
        href: "/admin/audit",
        icon: "scroll",
        permission: "audit.view",
      },
      {
        label: "Payments setup",
        href: "/admin/settings/payments",
        icon: "card",
        permission: "payment_provider.configure",
      },
      {
        label: "Tax",
        href: "/admin/settings/tax",
        icon: "receipt",
        permission: "tax.manage",
      },
      {
        label: "AI",
        href: "/admin/settings/ai",
        icon: "sparkles",
        permission: "ai.configure",
      },
      {
        label: "Settings",
        href: "/admin/settings",
        icon: "settings",
        permission: "settings.manage",
      },
    ],
  },
];

/* ────────────────────────────────────────────── public */

export const PUBLIC_NAV: readonly NavItem[] = [
  { label: "Marketplace", href: "/marketplace", icon: "store" },
  { label: "Custom build", href: "/custom-software", icon: "wrench" },
  { label: "Services", href: "/services", icon: "settings" },
  { label: "Pricing", href: "/pricing", icon: "receipt" },
];

/* ────────────────────────────────────────────── filtering */

/** Drop items the caller can't use, then drop sections left empty. */
function prune(
  sections: readonly NavSection[],
  keep: (item: NavItem) => boolean,
): NavSection[] {
  return sections
    .map((section) => ({ ...section, items: section.items.filter(keep) }))
    .filter((section) => section.items.length > 0);
}

/** The permissions an item accepts, as a list. Any one of them opens it. */
export function permissionsFor(item: NavItem): readonly Permission[] {
  const declared = item.permission;
  if (!declared) return [];
  // `Array.isArray` does not narrow a `T | readonly T[]` union — it is typed
  // against the mutable `any[]`, so the readonly branch stays in play.
  // Checking for the string is what actually discriminates here.
  return typeof declared === "string" ? [declared] : declared;
}

function permitted(item: NavItem, held: ReadonlySet<Permission>): boolean {
  const required = permissionsFor(item);
  return required.length === 0 || required.some((p) => held.has(p));
}

/**
 * The customer shell's navigation for one viewer.
 *
 * `isVendor` is a second, orthogonal predicate rather than a widened role: the
 * same person is a buyer with an organisation role *and* possibly a seller, and
 * conflating the two would make `role` mean two things. Defaulting it to `false`
 * keeps every existing caller and every existing test valid — an item without
 * `requiresVendor` is unaffected either way.
 */
export function customerNavFor(
  role: OrganizationRole,
  options: { isVendor?: boolean } = {},
): NavSection[] {
  return prune(
    CUSTOMER_NAV,
    (item) =>
      (!item.organizationRoles || item.organizationRoles.includes(role)) &&
      (!item.requiresVendor || options.isVendor === true),
  );
}

export function staffNavFor(permissions: ReadonlySet<Permission>): NavSection[] {
  const sections = prune(STAFF_NAV, (item) => permitted(item, permissions));
  // Offered exactly when `app/admin/layout.tsx` would admit them, because it is
  // the same predicate. Appended here rather than declared in `STAFF_NAV`: the
  // tables feed `ADMIN_PERMISSIONS`, and a link *gated on* that set, declared
  // *inside* the set's own source, is a circular definition.
  return canReachAdmin(permissions) ? [...sections, TO_ADMIN] : sections;
}

export function adminNavFor(permissions: ReadonlySet<Permission>): NavSection[] {
  return prune(ADMIN_NAV, (item) => permitted(item, permissions));
}

/**
 * The admin sidebar, plus the way back to the staff console.
 *
 * Separate from `adminNavFor` because that function answers a second question —
 * "may this person reach the admin area at all", which the layout decides by
 * whether it comes back empty. Appending an unguarded link to it made the
 * answer yes for everybody, which is how this was caught.
 */
export function adminShellNavFor(permissions: ReadonlySet<Permission>): NavSection[] {
  const sections = adminNavFor(permissions);
  return sections.length > 0 ? [...sections, TO_STAFF] : sections;
}

/** Does this permission set open at least one admin screen? */
export function canReachAdmin(permissions: ReadonlySet<Permission>): boolean {
  return ADMIN_PERMISSIONS.some((permission) => permissions.has(permission));
}

/** Every permission that opens at least one admin screen. */
export const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...new Set(ADMIN_NAV.flatMap((section) => section.items.flatMap(permissionsFor))),
];

/**
 * Is this item the current page?
 *
 * Exact match by default. `matchNested` extends it to children, with the
 * trailing slash mattering: without it `/dashboard/orders` would also light up
 * for `/dashboard/orders-archive`, a different screen.
 */
export function isActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  return Boolean(item.matchNested) && pathname.startsWith(`${item.href}/`);
}

/* ────────────────────────────────────────────── the deferred list */

/**
 * Post-MVP modules (spec phases 3–5). The ticket requires these appear
 * **nowhere** in navigation — a link to a module that does not exist is worse
 * than its absence, because it advertises capability the product lacks.
 *
 * `typedRoutes` already makes such a link a compile error. This list is the
 * second check, asserted by a unit test, and it stays useful for the case
 * typedRoutes cannot catch: a *real* route added for one of these later,
 * silently making the dead link legal.
 */
export const DEFERRED_MODULES: readonly string[] = [
  "projects",
  "milestones",
  "tasks",
  "deliverables",
  "testing",
  "uat",
  "change-requests",
  "tickets",
  "sla",
  "tech-assistant",
  "time-tracking",
  "maintenance",
  "subscriptions",
  "renewals",
  "sandboxes",
  "compare",
  "reviews",
];

/** Every nav item across every surface — for tests and for ticket 26's audit. */
export function allNavItems(): NavItem[] {
  return [
    ...CUSTOMER_NAV.flatMap((s) => s.items),
    ...STAFF_NAV.flatMap((s) => s.items),
    ...ADMIN_NAV.flatMap((s) => s.items),
    ...PUBLIC_NAV,
  ];
}
