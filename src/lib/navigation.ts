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
  /**
   * Vendor **owner** only — vendor ticket 03.
   *
   * A fourth predicate rather than a value folded into `requiresVendor`, because the two answer
   * different questions ("do you sell here" and "is this account yours") and a `member` invited
   * to help with products must not be shown a link to the payout account.
   */
  requiresVendorOwner?: true;
  /**
   * Drawn only for somebody who is **not** a vendor.
   *
   * Exactly one item uses this: the way in. "Sell Apps & Templates" has to be visible to a customer
   * who might want to — that entry point was missing entirely — and has to disappear the moment
   * they are one, because by then it points at a page they have already read.
   */
  hiddenForVendor?: true;
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
      // Same wording as `PUBLIC_NAV`, and for the same reason: the label names
      // what you get, not what we call the shelf it sits on.
      { label: "Software & Scripts", href: "/marketplace", icon: "store" },
      { label: "Website Templates", href: "/templates", icon: "tags" },
      {
        label: "Custom Requests",
        href: "/dashboard/requests",
        icon: "clipboard",
        matchNested: true,
      },
      { label: "Quotes", href: "/dashboard/quotes", icon: "file", matchNested: true },
    ],
  },
  {
    title: "Your software",
    items: [
      {
        label: "My Scripts",
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
    /*
     * The vendor workspace, in the shell — vendor tickets 01 through 13.
     *
     * ## Why every screen is here rather than behind one "Selling" link
     *
     * It started as a single item, with the intention that the rest would arrive with the tickets
     * that built them. They did — nine screens by ticket 13 — and the inner `<aside>` nav that
     * grew alongside them became a second navigation for the same section, one level down and
     * invisible until you were already inside it. A vendor's most common journey is *between*
     * those screens (a review, then a payout, then a product), and a nav you have to arrive
     * somewhere to see does not serve it.
     *
     * So the group lives here and the inner aside is gone. One nav, one place, and the section
     * disappears wholesale for a non-vendor because `prune` drops a section once its last item
     * does.
     *
     * ## The one item a non-vendor sees
     *
     * "Sell Apps & Templates" — the entry point that was missing. `/sell` existed, explained the
     * whole thing well, and was linked from nowhere at all; the only screen offering "Apply to
     * sell" was `/dashboard/selling`, whose nav item required already being a vendor. A closed
     * loop: the door worked and nothing led to it.
     *
     * ## Team is still deliberately absent
     *
     * The route exists and is reachable from vendor settings. A one-person vendor — the common
     * case — must not be walked through a team model to sell one script, and `navigation.test.ts`
     * asserts it stays unlinked.
     */
    title: "Vendor",
    items: [
      {
        /*
         * Straight to the form, not to `/sell`.
         *
         * `/sell` is the marketing page and it still exists — the footer links it, and
         * `/terms/vendor` offers it as "How selling works". But this item is inside
         * `/dashboard`, so its reader is already signed in and has already decided; sending
         * them to a page that argues the case is a step they have taken. The apply page
         * carries its own explanation of what happens next.
         */
        label: "Become a Vendor",
        href: "/dashboard/selling/apply",
        icon: "store",
        hiddenForVendor: true,
      },
      {
        label: "Vendor dashboard",
        href: "/dashboard/selling",
        icon: "store",
        // Deliberately **not** `matchNested`: every screen below has its own item now, and a
        // nested match would light two of them at once.
        requiresVendor: true,
      },
      {
        label: "Products",
        href: "/dashboard/selling/products",
        icon: "package",
        matchNested: true,
        requiresVendor: true,
      },
      {
        // Vendor ticket 14 — customization work a vendor has been asked to price. Above Earnings
        // because it is something waiting on them, and §102 puts what needs doing before any figure.
        label: "Requests",
        href: "/dashboard/selling/requests",
        icon: "clipboard",
        matchNested: true,
        requiresVendor: true,
      },
      {
        // Paid plugins the vendor still owes somebody a key for. Directly after
        // Requests and before Earnings for the same §102 reason: what is waiting
        // on them comes before any figure.
        label: "Plugins",
        href: "/dashboard/selling/plugins",
        icon: "checklist",
        requiresVendor: true,
      },
      {
        label: "Earnings",
        href: "/dashboard/selling/earnings",
        icon: "banknote",
        requiresVendor: true,
      },
      {
        label: "Payouts",
        href: "/dashboard/selling/payouts",
        icon: "card",
        matchNested: true,
        requiresVendor: true,
      },
      {
        // A preview, and the only storefront link a vendor can always follow — the public
        // `/vendors/[slug]` is 404 until they are verified with something published, so linking
        // *that* from the nav would put a not-found page in the sidebar of every new vendor.
        label: "Storefront",
        href: "/dashboard/selling/storefront",
        icon: "globe",
        requiresVendor: true,
      },
      {
        label: "Reviews",
        href: "/dashboard/selling/reviews",
        icon: "star",
        requiresVendor: true,
      },
      {
        label: "Support",
        href: "/dashboard/selling/support",
        icon: "messages",
        requiresVendor: true,
      },
      {
        label: "Verification",
        href: "/dashboard/selling/verification",
        icon: "checklist",
        requiresVendor: true,
      },
      {
        // Owner-only: it holds the payout account and the agreement, which is the one capability
        // the two-role model exists to separate. A `member` who saw this link would reach a 403.
        label: "Vendor settings",
        href: "/dashboard/selling/settings",
        icon: "settings",
        requiresVendorOwner: true,
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
       * `Organization` is not here, and the route now redirects.
       *
       * `/dashboard/organization` used to render a hardcoded empty state with no
       * query behind it — it would say "nothing to manage yet" however many
       * members an organisation had. A nav entry is a promise, and that one cost
       * a click to teach the customer the product was unfinished.
       *
       * Half of what it promised now exists: billing details are editable under
       * Account, so the route redirects there rather than sitting on a dead end.
       * Members and roles are still unbuilt, which is why it still has no entry
       * of its own — when there is something to manage, it earns one.
       */
      // `matchNested`, because the screen is four sibling routes under one rail
      // now: without it the sidebar item unhighlights the moment somebody opens
      // Security.
      {
        label: "Account",
        href: "/dashboard/account",
        icon: "userCog",
        matchNested: true,
      },
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
      // No permission, like `/staff` itself: every figure on it aggregates what
      // the queues already show a staff member one page over.
      { label: "Analytics", href: "/staff/dashboard", icon: "chart" },
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
      {
        /*
         * Vendor ticket 13. A dispute is the one thing where **both** parties are waiting
         * on us, so it gets its own queue rather than living inside the vendor screen —
         * a queue you have to open a vendor to find is a queue nobody works.
         */
        label: "Disputes",
        href: "/staff/disputes",
        icon: "scale",
        permission: "vendor.review",
      },
      {
        /*
         * Vendor ticket 10. Here rather than in `ADMIN_NAV` for the same reason as
         * Vendors above, plus one specific to this permission: `content_manager` holds
         * `review.moderate` and reaches **zero** admin screens, so an admin entry would
         * be an item they can see and a shell they cannot enter.
         */
        label: "Reviews",
        href: "/staff/reviews",
        icon: "star",
        permission: "review.moderate",
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
    /*
     * Untitled and first, because it is not one of the three areas below — it
     * reports across all of them.
     *
     * `report.view` is the one permission in the matrix whose only capability is
     * looking, which is a deliberate exception to the rule stated on `ADMIN_NAV`
     * below: admin screens are gated on the permission their *primary action*
     * needs. On a reporting screen, looking is the primary action. Note the
     * consequence — `ADMIN_PERMISSIONS` is derived from this array, so adding this
     * item widens the admin shell gate by exactly this permission, and it is
     * granted only to roles that already reach admin by another door.
     */
    items: [
      {
        label: "Analytics",
        href: "/admin/dashboard",
        icon: "chart",
        permission: "report.view",
      },
    ],
  },
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
        // Vendor ticket 09 — the only outbound money in the platform, so its own
        // item rather than a tab under Payments, which is entirely inbound.
        label: "Payouts",
        href: "/admin/payouts",
        icon: "banknote",
        permission: "payout.view_all",
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
        // Its own item because its own permission: setting our cut is a
        // commercial decision (`marketplace_manager`), and provider keys are not.
        label: "Commission",
        href: "/admin/settings/commission",
        icon: "percent",
        permission: "vendor.manage_commission",
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

/**
 * Three items, and each one says what you get rather than what we call it.
 *
 * "Marketplace" describes our side of the transaction; "Software & Scripts"
 * describes the customer's. Same for the other two — a visitor scanning a header
 * is matching words against what they came for, and "Custom build" only reads as
 * an offer once you already know what it means.
 *
 * ## Two things left
 *
 * `/services` is still a page and is still linked from the footer; it came out of
 * the header because it competes for attention with the three doors that actually
 * lead to a purchase (§100's progressive complexity — a visitor should not have to
 * rule out a service page before finding the catalogue).
 *
 * `/pricing` is **gone**, not hidden. It had no tiers to show — a marketplace
 * product is priced individually, custom work is quoted after scoping — so it
 * explained the *shape* of pricing and sent people to the catalogue for numbers.
 * The catalogue does that itself, and a page whose job is to point elsewhere is a
 * hop, not a destination.
 */
export const PUBLIC_NAV: readonly NavItem[] = [
  { label: "Software & Scripts", href: "/marketplace", icon: "store" },
  // The template catalogue's front door. Second, after the scripts: scripts are
  // the platform's main business and templates are the adjacent one, and the two
  // are separate storefronts rather than two views of one.
  { label: "Website Templates", href: "/templates", icon: "tags" },
  { label: "Request Custom Build", href: "/custom-software", icon: "wrench" },
  /*
   * The vendor door — COS-7.
   *
   * Last, and that ordering is the whole point: the brief asks for the sell path
   * to be visible without competing with buyer intent, and it was previously
   * reachable only from the footer. `/sell` is the public page; the authenticated
   * application form stays at `/dashboard/selling/apply`, which is where the
   * *customer* nav points it and which `navigation.test.ts` pins.
   */
  { label: "Sell", href: "/sell", icon: "banknote" },
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
 * `isVendor` and `isVendorOwner` are predicates *orthogonal* to the organisation role rather than
 * values folded into it: the same person is a buyer with a role, possibly a seller, and possibly
 * the seller's account holder. Conflating any two of those would make one field mean two things.
 *
 * Both default to `false`, which keeps every existing caller valid — an item with none of the three
 * vendor flags is unaffected either way.
 *
 * `isVendorOwner` does **not** imply `isVendor` automatically: the caller passes what it knows, and
 * an owner is a vendor by definition, so the layout passes both from the same context rather than
 * this function inferring one from the other.
 */
export function customerNavFor(
  role: OrganizationRole,
  options: { isVendor?: boolean; isVendorOwner?: boolean } = {},
): NavSection[] {
  return prune(
    CUSTOMER_NAV,
    (item) =>
      (!item.organizationRoles || item.organizationRoles.includes(role)) &&
      (!item.requiresVendor || options.isVendor === true) &&
      (!item.requiresVendorOwner || options.isVendorOwner === true) &&
      // The way in, hidden once you are through it.
      (!item.hiddenForVendor || options.isVendor !== true),
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
  /*
   * `"reviews"` was here and is now gone — vendor ticket 10.
   *
   * It was deferred with the rest of §6's "if introduced" list, and this test correctly
   * failed the moment `/staff/reviews` appeared in the nav. Removing the entry is the fix
   * rather than an exception, because the list means "post-MVP module with no route", and
   * reviews now have both a route and a reason: a marketplace where a rating decides a
   * purchase needs them, and `01-mvp-todo.md` records the un-deferral.
   */
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
