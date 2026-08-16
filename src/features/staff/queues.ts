import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { RequestStatus } from "@/lib/db/enums";
import { CustomerRequest, FollowUp, type CustomerRequestDoc } from "@/lib/db/models/requests";
import { Quote } from "@/lib/db/models/billing";
import { Organization, User } from "@/lib/db/models/identity";

/**
 * §31–32 — the staff portal is a queue of work, not a database browser.
 *
 * ## Every queue is a named filter, declared once
 *
 * The dashboard counter and the queue page must agree — an acceptance
 * criterion, and trivially broken by writing the filter twice. So each queue is
 * one entry here: a label, a filter, and a sort. The counter counts it and the
 * page lists it, from the same object.
 *
 * ## Oldest first, and that is not a default
 *
 * §32: the thing waiting longest is the thing most at risk. Newest-first is the
 * conventional table sort and it is wrong for a work queue — it buries the
 * request that has been sitting for nine days under this morning's arrivals.
 *
 * ## Indexes, deliberately
 *
 * `customerRequests` carries `{status, currentAssigneeUserId, updatedAt}`,
 * `{status, kind, createdAt}` and `{waitingOn, updatedAt}` from ticket 02, plus
 * `{status, currentAssigneeUserId, createdAt}` added for the `unassigned` queue
 * after `npm run db:explain:queues` showed it sorting 5,000 documents in memory
 * to return 100. With the index it examines 100.
 *
 * `technical-review` still sorts in memory — it filters one status and sorts by
 * `updatedAt`, which the composite index cannot serve because
 * `currentAssigneeUserId` sits between them. 68ms at ten thousand rows, so it
 * is inside budget and left alone; if this collection grows an order of
 * magnitude, `{status: 1, updatedAt: 1}` is the fix and the script is how you
 * would know.
 */

export type QueueKey =
  | "new-custom-build"
  | "new-customization"
  | "waiting-for-innovatrix"
  | "waiting-for-customer"
  | "technical-review"
  | "unassigned"
  | "mine"
  | "ready-to-start";

export interface QueueDefinition {
  key: QueueKey;
  label: string;
  /** One line saying what is in here and why it matters. */
  description: string;
  /**
   * `Record<string, unknown>` rather than Mongoose's `FilterQuery`: that type
   * is not exported from the package root in this version, and importing it
   * from a deep path couples these queue definitions to Mongoose's internals
   * for no benefit — the shapes are checked where they are used.
   */
  filter: (context: { staffUserId: string }) => Record<string, unknown>;
  /** Oldest first unless there is a reason. */
  sort: Record<string, 1 | -1>;
}

const OPEN: readonly RequestStatus[] = [
  "submitted",
  "under_review",
  "waiting_for_customer",
  "technical_review",
  "quoted",
];

export const QUEUES: readonly QueueDefinition[] = [
  {
    key: "new-custom-build",
    label: "New custom builds",
    description: "Nobody has looked at these yet.",
    filter: () => ({ status: "submitted", kind: "custom_build" }),
    sort: { createdAt: 1 },
  },
  {
    key: "new-customization",
    label: "New customizations",
    description: "Changes to something we already sell.",
    filter: () => ({ status: "submitted", kind: "customization" }),
    sort: { createdAt: 1 },
  },
  {
    key: "waiting-for-innovatrix",
    label: "Waiting on us",
    description: "The customer has done their part.",
    filter: () => ({ waitingOn: "innovatrix", status: { $in: OPEN } }),
    sort: { updatedAt: 1 },
  },
  {
    key: "waiting-for-customer",
    label: "Waiting on the customer",
    description: "We've asked something and haven't heard back.",
    filter: () => ({ waitingOn: "customer", status: "waiting_for_customer" }),
    sort: { updatedAt: 1 },
  },
  {
    key: "technical-review",
    label: "In technical review",
    description: "Being scoped by the technical team.",
    filter: () => ({ status: "technical_review" }),
    sort: { updatedAt: 1 },
  },
  {
    key: "unassigned",
    label: "Unassigned",
    description: "Open, and nobody owns it.",
    filter: () => ({
      status: { $in: OPEN },
      currentAssigneeUserId: { $exists: false },
    }),
    sort: { createdAt: 1 },
  },
  {
    /*
     * §52's work-order queue. A `converted` request is one whose invoice is
     * paid and whose work has not started — there is no project entity in the
     * MVP, so this list *is* the handover, and `WorkReadyToStart` is the event
     * ticket 53 will replace it with.
     */
    key: "ready-to-start",
    label: "Ready to start",
    description: "Paid and waiting on us to begin.",
    filter: () => ({ status: "converted" }),
    sort: { updatedAt: 1 },
  },
  {
    key: "mine",
    label: "Mine",
    description: "Assigned to you and still open.",
    filter: ({ staffUserId }) => ({
      currentAssigneeUserId: toObjectId(staffUserId),
      status: { $in: OPEN },
    }),
    sort: { updatedAt: 1 },
  },
];

export function findQueue(key: string): QueueDefinition | undefined {
  return QUEUES.find((queue) => queue.key === key);
}

/* ────────────────────────────────────────────── counts */

export interface StaffCounts {
  queues: Record<QueueKey, number>;
  quotesAwaiting: number;
  overdueFollowUps: number;
}

/**
 * All counters in one round of parallel counts.
 *
 * Each is a `countDocuments` against an indexed filter — never a `find().length`,
 * which is how a staff dashboard becomes the slowest page in the platform
 * exactly as the business grows.
 */
export async function staffCounts(staffUserId: string): Promise<StaffCounts> {
  await connectToDatabase();

  const [counts, quotesAwaiting, overdueFollowUps] = await Promise.all([
    Promise.all(
      QUEUES.map((queue) => CustomerRequest.countDocuments(queue.filter({ staffUserId }))),
    ),
    Quote.countDocuments({ status: "issued" }),
    FollowUp.countDocuments({ status: "open", dueAt: { $lt: new Date() } }),
  ]);

  return {
    queues: Object.fromEntries(
      QUEUES.map((queue, index) => [queue.key, counts[index]!]),
    ) as Record<QueueKey, number>,
    quotesAwaiting,
    overdueFollowUps,
  };
}

/* ────────────────────────────────────────────── rows */

export interface QueueRow {
  id: string;
  reference: string;
  title: string;
  kind: "customization" | "custom_build";
  status: RequestStatus;
  organizationName: string;
  assigneeName?: string;
  /** Whole days since it last moved — §32's "age" column. */
  ageDays: number;
  updatedAt: string;
}

export async function queueRows(
  queue: QueueDefinition,
  staffUserId: string,
  limit = 100,
): Promise<QueueRow[]> {
  await connectToDatabase();

  const rows = await CustomerRequest.find(queue.filter({ staffUserId }))
    .sort(queue.sort)
    .limit(limit)
    .lean<Array<CustomerRequestDoc & { createdAt: Date; updatedAt: Date }>>();

  if (rows.length === 0) return [];

  // Two lookups for the page, not two per row. A queue is the screen staff
  // leave open all day; N+1 here is felt immediately.
  const [organizations, assignees] = await Promise.all([
    Organization.find({ _id: { $in: rows.map((row) => row.organizationId) } })
      .select({ name: 1 })
      .lean<{ _id: unknown; name: string }[]>(),
    User.find({
      _id: {
        $in: rows
          .map((row) => row.currentAssigneeUserId)
          .filter((id): id is NonNullable<typeof id> => Boolean(id)),
      },
    })
      .select({ name: 1 })
      .lean<{ _id: unknown; name?: string }[]>(),
  ]);

  const orgName = new Map(organizations.map((org) => [String(org._id), org.name]));
  const userName = new Map(assignees.map((user) => [String(user._id), user.name ?? "Someone"]));

  const now = Date.now();

  return rows.map((row) => ({
    id: String(row._id),
    reference: row.reference,
    title: row.title,
    kind: row.kind,
    status: row.status,
    organizationName: orgName.get(String(row.organizationId)) ?? "Unknown",
    ...(row.currentAssigneeUserId
      ? { assigneeName: userName.get(String(row.currentAssigneeUserId)) ?? "Someone" }
      : {}),
    ageDays: Math.floor((now - new Date(row.updatedAt).getTime()) / 86_400_000),
    updatedAt: new Date(row.updatedAt).toISOString().slice(0, 10),
  }));
}
