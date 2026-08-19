import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import type { Route } from "next";
import { serverEnv } from "@/config/env";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { connectToDatabase } from "@/lib/db/client";
import {
  Organization,
  OrganizationMember,
  StaffProfile,
  type OrganizationDoc,
} from "@/lib/db/models/identity";
import { Vendor, VendorMember, type VendorDoc } from "@/lib/db/models/vendors";
import type { OrganizationRole, StaffRole, VendorRole } from "@/lib/db/enums";
import { getAuth } from "./auth";
import { hasSessionCookie } from "./session-cookies";
import {
  hasAllPermissions,
  hasAnyPermission,
  permissionsForRoles,
  type Permission,
} from "./permissions";

/**
 * Data Access Layer — §88 ("authorization on the server, close to the data").
 *
 * **Every server action, route handler and page calls one of these first.**
 * That is not a style preference. A server action is a public POST endpoint: a
 * hidden button, a filtered navigation item and a client-side redirect are all
 * cosmetic. If authorization does not happen here, it does not happen.
 *
 * ## The rule about `organizationId`
 *
 * Scope comes from the **session**, never from the request. `requireOrg()`
 * returns the organization the session is acting as; repositories take that
 * value. A client-supplied `organizationId` is treated as an untrusted
 * *claim* — `assertOrgAccess()` exists to check such a claim against the
 * session, and returns nothing you can use as scope on its own.
 *
 * ## Why everything is wrapped in React `cache`
 *
 * A page layout, the page itself and three components may each need the
 * session. `cache` memoizes per render pass, so that is one database read
 * rather than five. It also means these are cheap enough that there is no
 * excuse for a code path skipping them "for performance".
 */

/* ────────────────────────────────────────────── session */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified: boolean;
  isStaff: boolean;
  locale: string;
}

export interface AppSession {
  user: SessionUser;
  activeOrganizationId: string | null;
  sessionId: string;
}

/**
 * The raw session, or null. Prefer `requireUser()` — this exists for the
 * handful of surfaces that legitimately render both ways (the marketplace, the
 * site header).
 */
export const getSession = cache(async (): Promise<AppSession | null> => {
  // `headers()` first, deliberately. It is what tells Next.js this render is
  // dynamic, and argument-evaluation order means writing
  // `getAuth().api.getSession({ headers: await headers() })` builds the auth
  // instance — and so validates runtime environment — *before* the bailout
  // fires. During `next build` that turns a page which should simply have been
  // marked dynamic into a prerender failure.
  const requestHeaders = await headers();
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  if (!result?.user) return null;

  const user = result.user as typeof result.user & {
    isStaff?: boolean;
    locale?: string;
  };

  return {
    sessionId: String(result.session.id),
    activeOrganizationId: result.session.activeOrganizationId
      ? String(result.session.activeOrganizationId)
      : null,
    user: {
      id: String(user.id),
      email: user.email,
      name: user.name,
      image: user.image ?? null,
      emailVerified: Boolean(user.emailVerified),
      // Absent rather than false is possible only for documents written before
      // `additionalFields` declared the default; treat missing as "not staff".
      isStaff: user.isStaff === true,
      locale: user.locale ?? "en-GB",
    },
  };
});

/**
 * Where to send somebody who has no valid session.
 *
 * ## Not always `/login`
 *
 * If a session **cookie is present** and the session behind it is not valid,
 * sending them to `/login` produces an infinite redirect: `proxy.ts` guards the
 * protected areas by cookie *presence* — deliberately, so it never touches the
 * database — and so it bounces `/login` straight back to `/dashboard`, where
 * this function runs again. The browser stops with `ERR_TOO_MANY_REDIRECTS`.
 *
 * So a stale cookie goes to the route that can actually delete it. A visitor
 * with no cookie at all has nothing to clear and goes to `/login` directly.
 *
 * Returns the path rather than redirecting, so the call site keeps
 * `redirect(...)` as its last statement — TypeScript narrows on `never` from a
 * direct call and not through an awaited one, and losing that narrowing means
 * every caller below needs a null check for a branch that cannot be reached.
 */
export async function loginDestination(): Promise<Route> {
  // A cookie is here but `getSession()` found nothing behind it ⇒ stale, and
  // it has to be deleted or the proxy will keep asserting the user is signed in.
  const stale = hasSessionCookie(await cookies());
  return (stale ? "/api/auth/stale-session" : "/login") as Route;
}

/** Signed in, or redirected to login with a return path. */
export const requireUser = cache(async (): Promise<SessionUser> => {
  const session = await getSession();
  if (!session) redirect(await loginDestination());
  return session.user;
});

/**
 * Signed in **and** email-verified. §75: verification gates purchase, not
 * browsing — so this belongs at checkout, not in the layout.
 */
export const requireVerifiedUser = cache(async (): Promise<SessionUser> => {
  const user = await requireUser();
  // The flag exists so a seeded demo environment can transact without a real
  // mailbox. It defaults to true, and turning it off in production would let an
  // unverified address buy software.
  if (!serverEnv().AUTH_REQUIRE_EMAIL_VERIFICATION) return user;
  if (!user.emailVerified) {
    throw new ForbiddenError("Please confirm your email address before completing a purchase.");
  }
  return user;
});

/* ────────────────────────────────────────────── organization */

export interface OrgContext {
  user: SessionUser;
  organization: OrganizationDoc;
  organizationId: string;
  role: OrganizationRole;
}

/**
 * The organization the session is currently acting as, with the caller's role
 * in it.
 *
 * The membership is re-read from the database on every call rather than trusted
 * from the session. That is deliberate and is what makes "remove a member"
 * take effect immediately: the session still carries
 * `activeOrganizationId`, but the membership behind it is gone, so access ends
 * on the next request rather than whenever the session happens to expire.
 */
export const requireOrg = cache(async (): Promise<OrgContext> => {
  const session = await getSession();
  if (!session) redirect(await loginDestination());

  if (!session.activeOrganizationId) {
    // A signed-in user with no organization is a broken signup, not a normal
    // state — every customer gets a personal org at registration.
    throw new ForbiddenError("No active organization for this session.");
  }

  await connectToDatabase();

  const membership = await OrganizationMember.findOne({
    organizationId: session.activeOrganizationId,
    userId: session.user.id,
    status: "active",
  }).lean();

  if (!membership) {
    throw new ForbiddenError("You no longer have access to this organization.");
  }

  const organization = await Organization.findOne({
    _id: session.activeOrganizationId,
    deletedAt: null,
  }).lean<OrganizationDoc>();

  if (!organization) {
    throw new NotFoundError("organization", { id: session.activeOrganizationId });
  }

  return {
    user: session.user,
    organization,
    organizationId: String(organization._id),
    role: membership.role,
  };
});

/**
 * `requireOrg`, but for a **route handler**.
 *
 * `requireOrg` redirects to `/login` and throws `ForbiddenError`, which are the
 * right behaviours in a page and the wrong ones in an API route: a redirect to
 * an HTML login page is not a useful answer to `fetch`, and a thrown error
 * becomes a 500 with a redacted digest rather than the 401 or 403 the caller
 * can act on.
 *
 * Same checks, same re-read of the membership — only the failure shape differs.
 *
 * ⚠️ It swallows the `NEXT_REDIRECT` that `redirect()` throws, which is exactly
 * what a route handler wants and exactly wrong in a **page** — there, the
 * redirect would silently become a `null` and the page would render as though
 * the visitor were merely org-less. Pages call `requireOrg`.
 */
export const requireOrgOrNull = cache(async (): Promise<OrgContext | null> => {
  try {
    return await requireOrg();
  } catch {
    return null;
  }
});

/* ────────────────────────────────────────────── vendor */

export interface VendorContext {
  user: SessionUser;
  vendor: VendorDoc;
  vendorId: string;
  role: VendorRole;
}

/**
 * The vendor the session belongs to — vendor tickets 01 and 03.
 *
 * ## A third principal, not a third shell
 *
 * `requireOrg()` establishes customer tenancy and `requireStaff()` establishes
 * platform staff; neither stretches to cover selling. But a new principal does
 * not require a new app shell, and the vendor screens live at
 * `/dashboard/selling` *inside* the customer one. That is a routing decision and
 * this is the enforcement: **no vendor screen may take its scope from the
 * enclosing layout's `requireOrg()`**. Scope comes from here, every time.
 *
 * ## One vendor per user
 *
 * There is no `activeVendorId` on the session and no switcher, because a user
 * has at most one active membership — enforced by a partial unique index on
 * `VendorMember.userId`. So the lookup is by user, and it cannot be influenced
 * by anything the request carries.
 *
 * Like `requireOrg`, the membership is re-read on every call rather than trusted
 * from the session, which is what makes revoking a member take effect on their
 * next request rather than whenever their session happens to expire — the
 * session cookie cache is 60 seconds and a revocation should not wait for it.
 */
export const requireVendor = cache(async (): Promise<VendorContext> => {
  const session = await getSession();
  if (!session) redirect(await loginDestination());

  await connectToDatabase();

  const membership = await VendorMember.findOne({
    userId: session.user.id,
    status: "active",
  }).lean();

  if (!membership) {
    // Not an error: a customer with no vendor is the normal case, and the useful
    // answer is the application form rather than a refusal.
    redirect("/dashboard/selling/apply");
  }

  const vendor = await Vendor.findOne({
    _id: membership.vendorId,
    deletedAt: null,
  }).lean<VendorDoc>();

  if (!vendor) {
    throw new NotFoundError("vendor", { id: String(membership.vendorId) });
  }

  return {
    user: session.user,
    vendor,
    vendorId: String(vendor._id),
    role: membership.role,
  };
});

/**
 * `requireVendor`, but returning `null` instead of redirecting.
 *
 * For the `/dashboard/selling` layout, which must distinguish "no vendor" (draw
 * the application entry point) from "not signed in" — and for the customer
 * shell, which needs to know whether to draw the Selling group at all.
 *
 * ⚠️ Swallows `NEXT_REDIRECT`, same hazard as `requireOrgOrNull`: in a page a
 * signed-out visitor would silently render as merely vendor-less. Pages call
 * `requireVendorOrForbid`.
 */
export const requireVendorOrNull = cache(async (): Promise<VendorContext | null> => {
  try {
    return await requireVendor();
  } catch {
    return null;
  }
});

/** For a vendor page. Renders the 403 UI rather than redirecting. */
export async function requireVendorOrForbid(): Promise<VendorContext> {
  const session = await getSession();
  if (!session) redirect(await loginDestination());

  await connectToDatabase();

  const membership = await VendorMember.findOne({
    userId: session.user.id,
    status: "active",
  }).lean();

  if (!membership) forbidden();

  const vendor = await Vendor.findOne({
    _id: membership.vendorId,
    deletedAt: null,
  }).lean<VendorDoc>();

  if (!vendor) forbidden();

  return {
    user: session.user,
    vendor,
    vendorId: String(vendor._id),
    role: membership.role,
  };
}

/**
 * Owner only — the payout account, the agreement, and the membership list.
 *
 * This is the whole point of having two roles rather than one. A wrong price is
 * reversible and audited; a wrong bank account is money in a stranger's hands.
 * Everything else a vendor does is reachable by any active member, which is why
 * there is no `requireVendorRoleOrForbid(roles)` — one boolean needs no set.
 */
export async function requireVendorOwner(): Promise<VendorContext> {
  const context = await requireVendorOrForbid();
  if (context.role !== "owner") forbidden();
  return context;
}

/**
 * Check a **client-supplied** organization id against the session.
 *
 * Note what this does not do: it does not return the id for use as scope. If a
 * caller wants scope, it calls `requireOrg()` and uses what the session says.
 * This is only for the case where a request carries an organization id that
 * must be proven to belong to the caller — a webhook return URL, a deep link.
 *
 * ## It has no callers, and that is the point
 *
 * Ticket 26's audit asked "is an `organizationId` ever accepted from client
 * input for scoping?" The answer is no — every scoped read takes it from
 * `requireOrg()` — so the function that would validate one has nothing to
 * validate.
 *
 * Kept rather than deleted, because the alternative to having it is that the
 * first person who *does* need to accept an org id writes the membership check
 * inline, or forgets to. `action-guards.test.ts` asserts that no action schema
 * declares an `organizationId` field, so this staying unused is enforced rather
 * than merely true today. It is exercised by `tenant-isolation.integration.test.ts`
 * so it is not also untested.
 */
export async function assertOrgAccess(claimedOrganizationId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect(await loginDestination());

  await connectToDatabase();

  const membership = await OrganizationMember.findOne({
    organizationId: claimedOrganizationId,
    userId: session.user.id,
    status: "active",
  })
    .select({ _id: 1 })
    .lean();

  if (!membership) {
    // Same error whether the organization doesn't exist or isn't theirs —
    // distinguishing the two confirms the existence of other customers' orgs.
    throw new ForbiddenError("You don't have access to that organization.");
  }
}

/** Every organization the user belongs to — for the org switcher. */
export const listUserOrganizations = cache(
  async (): Promise<
    Array<{ id: string; name: string; slug: string; role: OrganizationRole }>
  > => {
    const session = await getSession();
    if (!session) return [];

    await connectToDatabase();

    const memberships = await OrganizationMember.find({
      userId: session.user.id,
      status: "active",
    })
      .select({ organizationId: 1, role: 1 })
      .limit(100)
      .lean();

    if (memberships.length === 0) return [];

    const organizations = await Organization.find({
      _id: { $in: memberships.map((m) => m.organizationId) },
      deletedAt: null,
    })
      .select({ name: 1, slug: 1 })
      .lean();

    const roleById = new Map(memberships.map((m) => [String(m.organizationId), m.role]));

    return organizations.map((org) => ({
      id: String(org._id),
      name: org.name,
      slug: org.slug,
      role: roleById.get(String(org._id)) ?? "member",
    }));
  },
);

/* ────────────────────────────────────────────── staff */

export interface StaffContext {
  user: SessionUser;
  roles: StaffRole[];
  teams: string[];
  permissions: ReadonlySet<Permission>;
}

/**
 * Staff identity and effective permissions.
 *
 * `user.isStaff` is only a cheap gate for "should this request even look at
 * /staff". The authority is the `staffProfiles` document — a user flagged
 * `isStaff` with no active profile has no permissions and is refused here,
 * which is what makes deactivating someone a single write.
 */
export const requireStaff = cache(async (): Promise<StaffContext> => {
  const session = await getSession();
  if (!session) redirect(await loginDestination());

  if (!session.user.isStaff) {
    throw new ForbiddenError("This area is for CoSetup staff.");
  }

  await connectToDatabase();

  const profile = await StaffProfile.findOne({
    userId: session.user.id,
    isActive: true,
    deletedAt: null,
  }).lean();

  if (!profile) {
    throw new ForbiddenError("Your staff account is not active.");
  }

  return {
    user: session.user,
    roles: profile.roles,
    teams: profile.teams,
    permissions: permissionsForRoles(profile.roles),
  };
});

/**
 * Assert a single staff permission. The workhorse — most staff server actions
 * begin with exactly one call to this.
 */
export async function requirePermission(permission: Permission): Promise<StaffContext> {
  const staff = await requireStaff();
  if (!staff.permissions.has(permission)) {
    throw new ForbiddenError(`You don't have permission to do that (${permission}).`);
  }
  return staff;
}

/** All of them. */
export async function requireAllPermissions(
  permissions: readonly Permission[],
): Promise<StaffContext> {
  const staff = await requireStaff();
  if (!hasAllPermissions(staff.permissions, permissions)) {
    throw new ForbiddenError("You don't have permission to do that.");
  }
  return staff;
}

/** Any one of them — for a screen reachable by several roles. */
export async function requireAnyPermission(
  permissions: readonly Permission[],
): Promise<StaffContext> {
  const staff = await requireStaff();
  if (!hasAnyPermission(staff.permissions, permissions)) {
    throw new ForbiddenError("You don't have permission to do that.");
  }
  return staff;
}

/* ────────────────────────────────────────────── layout guards

   Layouts and pages want different behaviour from the same failure, and the
   difference is not cosmetic.

   An error thrown from a **layout** cannot be caught by the `error.tsx` in its
   own segment — that boundary wraps the layout's children, not the layout
   itself. It escapes to the root, where Next.js renders `not-found.tsx` with a
   404. So a customer who wandered into `/staff`, and a staff member whose
   profile was deactivated, both get "page not found" — which is wrong for the
   first (they took a wrong turn) and actively misleading for the second.

   So: **layouts redirect, pages and actions throw.** A wrong turn is a
   navigation problem; a refused action is an authorization problem, and only
   the second should surface as an error.                                     */

/**
 * For the `/staff` layout. Sends a non-staff visitor back to their dashboard
 * rather than showing them an error for a door they were never meant to see.
 */
export const requireStaffOrRedirect = cache(async (): Promise<StaffContext> => {
  const session = await getSession();
  if (!session) redirect(await loginDestination());
  if (!session.user.isStaff) redirect("/dashboard?denied=staff");

  await connectToDatabase();
  const profile = await StaffProfile.findOne({
    userId: session.user.id,
    isActive: true,
    deletedAt: null,
  }).lean();

  // Flagged as staff but with no active profile — deactivated, or a half-built
  // account. Not an error they can act on, so it reads as a wrong turn too.
  if (!profile) redirect("/dashboard?denied=staff");

  return {
    user: session.user,
    roles: profile.roles,
    teams: profile.teams,
    permissions: permissionsForRoles(profile.roles),
  };
});

/** For the `/admin` layout: staff, holding at least one of `permissions`. */
export async function requireAnyPermissionOrRedirect(
  permissions: readonly Permission[],
): Promise<StaffContext> {
  const staff = await requireStaffOrRedirect();
  if (!hasAnyPermission(staff.permissions, permissions)) {
    redirect("/staff?denied=admin");
  }
  return staff;
}

/* ────────────────────────────────────────────── page guards

   Three flavours of the same check, because three callers need three different
   outcomes from the same failure. Pick by where you are:

   | Caller        | Function                        | On failure          |
   |---------------|---------------------------------|---------------------|
   | layout        | `…OrRedirect`                   | redirect (a wrong turn) |
   | page          | `…OrForbid`                     | a real 403 page     |
   | server action | `requirePermission` / `…Any…`   | throws `ForbiddenError` |

   The page variant exists because `throw` in a page is caught by `error.tsx`,
   and an error boundary renders **client-side with a 200 status**. Without
   JavaScript the refused user gets a blank content area, and anything reading
   status codes is told the request succeeded. `forbidden()` renders on the
   server, returns 403, and marks the page `noindex`.                        */

/** For a page. Renders the 403 UI in `app/forbidden.tsx`. */
export async function requirePermissionOrForbid(permission: Permission): Promise<StaffContext> {
  const staff = await requireStaffOrRedirect();
  if (!staff.permissions.has(permission)) forbidden();
  return staff;
}

/**
 * For a **customer** page gated on the organisation role — §89.
 *
 * The staff guards above are about permissions; this is the customer-side
 * equivalent, and it exists for the same reason: `NAV`'s `organizationRoles`
 * decides what is *drawn*, and a filtered nav item without a matching check on
 * the page is a link somebody can still type. Billing screens are the case that
 * makes it matter — a technical contact has no business reading invoices.
 */
export async function requireOrgRoleOrForbid(
  roles: readonly OrganizationRole[],
): Promise<OrgContext> {
  const context = await requireOrg();
  if (!roles.includes(context.role)) forbidden();
  return context;
}

/** For a page, where several permissions each open the screen. */
export async function requireAnyPermissionOrForbid(
  permissions: readonly Permission[],
): Promise<StaffContext> {
  const staff = await requireStaffOrRedirect();
  if (!hasAnyPermission(staff.permissions, permissions)) forbidden();
  return staff;
}

/**
 * Non-throwing check, for deciding whether to *render* something.
 *
 * Hiding a control is a courtesy, not a control. Whatever the hidden control
 * would have submitted must still call `requirePermission` on the server.
 */
export const staffPermissions = cache(async (): Promise<ReadonlySet<Permission>> => {
  const session = await getSession();
  if (!session?.user.isStaff) return new Set();

  await connectToDatabase();
  const profile = await StaffProfile.findOne({
    userId: session.user.id,
    isActive: true,
    deletedAt: null,
  })
    .select({ roles: 1 })
    .lean();

  return profile ? permissionsForRoles(profile.roles) : new Set();
});

export async function can(permission: Permission): Promise<boolean> {
  return (await staffPermissions()).has(permission);
}
