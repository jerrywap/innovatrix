import "server-only";
import type { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import { AuditLog } from "@/lib/db/models/communication";
import { Organization, User } from "@/lib/db/models/identity";
import type { ActorType, SubjectType } from "@/lib/db/enums";
import type { ListParams } from "@/lib/list-params";

/**
 * Reading the audit log — §90's "staff-visible viewer with filters".
 *
 * ## The filters are the feature
 *
 * A reverse-chronological list of everything is a log file with a nicer font.
 * The questions somebody actually arrives with are "what did this person do",
 * "what happened to this order", and "who has been refunding things" — so the
 * filters are actor, subject and action, and the free-text box searches the
 * action name rather than the payloads.
 *
 * ## Not searching `before`/`after`
 *
 * They are `Mixed`, unindexed, and hold arbitrary shapes. A regex over them
 * would be a collection scan on the one collection that only ever grows, and it
 * would be the slowest query in the admin area within a year.
 */

export interface AuditRow {
  id: string;
  action: string;
  actorType: ActorType;
  actorName: string;
  subject?: string;
  organizationName?: string;
  /** Absolute — a log read six months later needs a date, not "3 days ago". */
  at: string;
  ip?: string;
  changed?: string;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
}

/** Populated from the collection itself, so the filter offers what exists. */
export async function auditActions(): Promise<string[]> {
  await connectToDatabase();
  const actions = await AuditLog.distinct("action");
  return (actions as string[]).sort();
}

export async function listAuditLog(
  params: ListParams,
  filters: { action?: string; actorType?: string; subjectType?: string } = {},
): Promise<AuditPage> {
  await connectToDatabase();

  const filter: Record<string, unknown> = {};

  if (filters.action) filter.action = filters.action;
  if (filters.actorType) filter.actorType = filters.actorType;
  if (filters.subjectType) filter.subjectType = filters.subjectType;

  if (params.q) {
    // Anchored, and the term is escaped. An unanchored regex on an unindexed
    // field is a scan; anchored, this can use the `action` index.
    filter.action = { $regex: `^${escapeRegex(params.q)}`, $options: "i" };
  }

  const [docs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((params.page - 1) * params.limit)
      // Bounded by `parseListParams`, which clamps `limit` to 100 (§94).
      .limit(params.limit)
      .lean<
        Array<{
          _id: Types.ObjectId;
          action: string;
          actorType: ActorType;
          actorUserId?: Types.ObjectId;
          organizationId?: Types.ObjectId;
          subjectType?: SubjectType;
          subjectId?: Types.ObjectId;
          before?: Record<string, unknown>;
          after?: Record<string, unknown>;
          ip?: string;
          createdAt: Date;
        }>
      >(),
    AuditLog.countDocuments(filter),
  ]);

  // Two lookups for the page rather than two per row.
  const [users, organizations] = await Promise.all([
    User.find({ _id: { $in: actorIds(docs) } })
      .select({ name: 1, email: 1 })
      .lean<Array<{ _id: Types.ObjectId; name?: string; email: string }>>(),
    Organization.find({ _id: { $in: orgIds(docs) } })
      .select({ name: 1 })
      .lean<Array<{ _id: Types.ObjectId; name: string }>>(),
  ]);

  const userName = new Map(users.map((u) => [String(u._id), u.name ?? u.email]));
  const orgName = new Map(organizations.map((o) => [String(o._id), o.name]));

  return {
    total,
    rows: docs.map((doc) => ({
      id: String(doc._id),
      action: doc.action,
      actorType: doc.actorType,
      actorName: doc.actorUserId
        ? // A deleted user still has rows here — that is the point of an
          // append-only log — so the id is the fallback rather than "unknown".
          (userName.get(String(doc.actorUserId)) ?? String(doc.actorUserId))
        : doc.actorType,
      ...(doc.subjectType && doc.subjectId
        ? { subject: `${doc.subjectType} ${String(doc.subjectId)}` }
        : {}),
      ...(doc.organizationId
        ? { organizationName: orgName.get(String(doc.organizationId)) ?? "—" }
        : {}),
      at: new Date(doc.createdAt).toISOString().replace("T", " ").slice(0, 19),
      ...(doc.ip ? { ip: doc.ip } : {}),
      ...(summarise(doc.before, doc.after)
        ? { changed: summarise(doc.before, doc.after)! }
        : {}),
    })),
  };
}

/**
 * `status: ready → published`, in one line.
 *
 * The full payloads are on the row and the interesting part is almost always a
 * field or two. Rendering both objects would make every row four lines tall and
 * bury the ones that matter.
 */
function summarise(
  before?: Record<string, unknown>,
  after?: Record<string, unknown>,
): string | undefined {
  if (!after && !before) return undefined;

  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (keys.length === 0) return undefined;

  return keys
    .slice(0, 3)
    .map((key) => {
      const from = before?.[key];
      const to = after?.[key];
      if (from !== undefined && to !== undefined)
        return `${key}: ${short(from)} → ${short(to)}`;
      return `${key}: ${short(to ?? from)}`;
    })
    .join(" · ");
}

/**
 * `.filter(Boolean)` narrows to `(ObjectId | undefined)[]` as far as TypeScript
 * is concerned, which Mongoose's `$in` rightly refuses. A type predicate says
 * what the filter actually did.
 */
function actorIds(docs: Array<{ actorUserId?: Types.ObjectId }>): Types.ObjectId[] {
  return docs
    .map((doc) => doc.actorUserId)
    .filter((id): id is Types.ObjectId => id !== undefined);
}

function orgIds(docs: Array<{ organizationId?: Types.ObjectId }>): Types.ObjectId[] {
  return docs
    .map((doc) => doc.organizationId)
    .filter((id): id is Types.ObjectId => id !== undefined);
}

function short(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return Array.isArray(value) ? `[${value.length}]` : "{…}";
  return String(value).slice(0, 40);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
