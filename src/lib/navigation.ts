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
      {
        label: "Organization",
        href: "/dashboard/organization",
        icon: "building",
        organizationRoles: ["owner", "admin"],
      },
      { label: "Account", href: "/dashboard/account", icon: "userCog" },
    ],
  },
];

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
        label: "Customers",
        href: "/staff/customers",
        icon: "users",
        permission: "customer.view_all",
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

export function customerNavFor(role: OrganizationRole): NavSection[] {
  return prune(
    CUSTOMER_NAV,
    (item) => !item.organizationRoles || item.organizationRoles.includes(role),
  );
}

export function staffNavFor(permissions: ReadonlySet<Permission>): NavSection[] {
  return prune(STAFF_NAV, (item) => permitted(item, permissions));
}

export function adminNavFor(permissions: ReadonlySet<Permission>): NavSection[] {
  return prune(ADMIN_NAV, (item) => permitted(item, permissions));
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
