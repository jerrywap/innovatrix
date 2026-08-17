import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { SubjectType } from "@/lib/db/enums";
import { FollowUp, type FollowUpDoc } from "@/lib/db/models/requests";
import { CustomerRequest } from "@/lib/db/models/requests";
import { Organization, User } from "@/lib/db/models/identity";
import { formatDay } from "@/lib/dates";

/**
 * Follow-ups — §39.
 *
 * *"Follow up with the customer tomorrow"*, *"check the payment Monday"*. A
 * reminder attached to a record, owned by a person, with a date.
 *
 * ## Overdue is the only view that really matters
 *
 * §39 says overdue must appear prominently, and the reason is what a follow-up
 * is *for*: it exists because somebody decided this would fall through the
 * cracks otherwise. A follow-up nobody sees is worse than none — it converts an
 * intention into a false sense that it is handled.
 *
 * So overdue leads, `{status, dueAt}` is indexed for it, and the staff
 * dashboard counts it on every load.
 */

export type FollowUpScope = "mine" | "overdue" | "team" | "done";

export interface FollowUpRow {
  id: string;
  note: string;
  dueAt: string;
  status: FollowUpDoc["status"];
  overdue: boolean;
  ownerName: string;
  organizationName: string;
  subjectType: SubjectType;
  subjectId: string;
  /** A reference when we can resolve one, so the row links somewhere useful. */
  subjectReference?: string;
}

const FILTERS: Record<FollowUpScope, (staffUserId: string) => Record<string, unknown>> = {
  mine: (staffUserId) => ({ ownerUserId: toObjectId(staffUserId), status: "open" }),
  overdue: () => ({ status: "open", dueAt: { $lt: new Date() } }),
  team: () => ({ status: "open" }),
  done: () => ({ status: { $in: ["done", "cancelled"] } }),
};

export async function listFollowUps(
  scope: FollowUpScope,
  staffUserId: string,
  limit = 100,
): Promise<FollowUpRow[]> {
  await connectToDatabase();

  const rows = await FollowUp.find(FILTERS[scope](staffUserId))
    // Soonest first. A follow-up list sorted any other way makes the reader do
    // the triage the sort should have done.
    .sort({ dueAt: 1 })
    .limit(limit)
    .lean<FollowUpDoc[]>();

  if (rows.length === 0) return [];

  // Three lookups for the page rather than three per row.
  const [owners, organizations, requests] = await Promise.all([
    User.find({ _id: { $in: rows.map((row) => row.ownerUserId) } })
      .select({ name: 1 })
      .lean<{ _id: unknown; name?: string }[]>(),
    Organization.find({ _id: { $in: rows.map((row) => row.organizationId) } })
      .select({ name: 1 })
      .lean<{ _id: unknown; name: string }[]>(),
    CustomerRequest.find({
      _id: {
        $in: rows.filter((row) => row.subjectType === "request").map((row) => row.subjectId),
      },
    })
      .select({ reference: 1 })
      .lean<{ _id: unknown; reference: string }[]>(),
  ]);

  const ownerName = new Map(owners.map((user) => [String(user._id), user.name ?? "Someone"]));
  const orgName = new Map(organizations.map((org) => [String(org._id), org.name]));
  const requestRef = new Map(
    requests.map((request) => [String(request._id), request.reference]),
  );

  const now = Date.now();

  return rows.map((row) => ({
    id: String(row._id),
    note: row.note,
    dueAt: formatDay(row.dueAt),
    status: row.status,
    overdue: row.status === "open" && new Date(row.dueAt).getTime() < now,
    ownerName: ownerName.get(String(row.ownerUserId)) ?? "Someone",
    organizationName: orgName.get(String(row.organizationId)) ?? "Unknown",
    subjectType: row.subjectType,
    subjectId: String(row.subjectId),
    ...(requestRef.has(String(row.subjectId))
      ? { subjectReference: requestRef.get(String(row.subjectId))! }
      : {}),
  }));
}

export async function countFollowUps(
  staffUserId: string,
): Promise<Record<FollowUpScope, number>> {
  await connectToDatabase();

  const scopes = Object.keys(FILTERS) as FollowUpScope[];
  const counts = await Promise.all(
    scopes.map((scope) => FollowUp.countDocuments(FILTERS[scope](staffUserId))),
  );

  return Object.fromEntries(scopes.map((scope, index) => [scope, counts[index]!])) as Record<
    FollowUpScope,
    number
  >;
}
