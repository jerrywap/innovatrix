import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStaffOrRedirect } from "@/lib/auth/dal";
import { UNASSIGNED_QUEUE } from "@/lib/navigation";

export const metadata: Metadata = { title: "Requests" };

/**
 * There is no "all requests" table, and that is §30's point.
 *
 * *"Should not simply be a generic admin table."* A flat list of every request
 * ever is a database browser — it answers "what exists", which nobody needs,
 * rather than "what should I do next", which is the whole job. So this
 * redirects to the queue of things nobody has picked up.
 *
 * Kept as a route rather than deleted because `/staff/requests/[reference]`
 * lives underneath it, and a parent that 404s while its children work is the
 * kind of thing people report as a bug.
 *
 * ## Nothing in the app links here any more
 *
 * The staff nav used to, and the link was **silently dead**: this route has a
 * prerendered shell, a prefetch is answered from that shell without ever running
 * the guard below, so the payload the router caches contains no redirect — and
 * the click then resolves from that cache, issues no request, and changes
 * nothing. `STAFF_NAV` now points straight at `UNASSIGNED_QUEUE` instead.
 *
 * This page therefore serves typed URLs, bookmarks and anything outside the app,
 * all of which arrive as document navigations where the redirect works normally.
 */
export default async function Page() {
  await requireStaffOrRedirect();
  redirect(UNASSIGNED_QUEUE);
}
