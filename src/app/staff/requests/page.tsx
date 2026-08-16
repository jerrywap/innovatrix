import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStaffOrRedirect } from "@/lib/auth/dal";

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
 */
export default async function Page() {
  await requireStaffOrRedirect();
  redirect("/staff/queue/unassigned");
}
