import "server-only";
import type { ClientSession } from "mongoose";
import { connectToDatabase } from "@/lib/db/client";
import { AuditLog, type AuditLogDoc } from "@/lib/db/models/communication";
import { toObjectId } from "@/lib/db/base";
import type { SubjectType } from "@/lib/db/enums";
import { redact } from "@/lib/redact";
import { log } from "@/lib/logger";

/**
 * The audit log — §90.
 *
 * A staff/security record of *who changed what*, distinct from the customer-
 * facing activity narrative (`activityEvents`, ticket 19). The distinction is
 * already documented on the models; this module is the only writer.
 *
 * ## Append-only
 *
 * `AuditLogRepository` refuses update and delete outright, so append-only is a
 * property of the code rather than a convention someone might not know about.
 * Nothing here offers a way to amend an entry.
 *
 * ## What `before` and `after` hold
 *
 * **Only the fields that changed** — never a document snapshot. Snapshotting a
 * product would put every price *and every `passwordCipher`* into a collection
 * that is never deleted, and would create a second place credentials live. A
 * status transition records `{ status: "ready" } → { status: "published" }` and
 * nothing else.
 *
 * `redactAuditPayload` strips anything that looks like a secret as a backstop,
 * because the caller is the thing most likely to be wrong.
 *
 * ## Sessions
 *
 * Given a session, this **throws** — it is part of the atomic unit, and a
 * transition that committed without its audit row is exactly what §90 exists to
 * prevent. Without one it **swallows and logs**: a best-effort read-audit
 * (`demo_credentials_revealed`) must not fail the thing it is recording.
 *
 * Writing inside `withTransaction` is safe despite that helper's warning about
 * the callback running twice. The warning is about side effects that *escape*
 * the transaction — S3 writes, emails, provider calls. An insert made in the
 * session and then aborted never commits, so a replay cannot duplicate it.
 */

export type AuditActor =
  | { type: "staff"; userId: string; name?: string }
  /**
   * `organizationId` is optional, and only because of auth events.
   *
   * Every *domain* action a customer takes happens inside an organisation, and
   * the caller passes it. But a session is created before an organisation is
   * chosen — at signup, on an invitation acceptance, for somebody between
   * organisations — and §90 wants that recorded with the person named.
   *
   * The alternatives were both worse: `organizationId: ""` puts a blank id in
   * an append-only collection, and falling back to a `system` actor loses the
   * user, which is the one field an incident review starts from.
   */
  | { type: "customer"; userId: string; organizationId?: string; name?: string }
  | { type: "system" }
  | { type: "webhook"; source: string };

export interface AuditEntry {
  /** `resource.verb_past_tense` — `product.status_changed`, `taxonomy.deleted`. */
  action: string;
  actor: AuditActor;
  /**
   * `SubjectType`, not a free string. A typo would produce audit rows that the
   * subject-scoped index cannot find, so the compiler decides the vocabulary.
   */
  subject?: { type: SubjectType; id: string };
  organizationId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Read in the action via `headers()`; services never reach for request context. */
  ip?: string;
  userAgent?: string;
  source?: string;
}

/**
 * Strip anything whose key suggests a secret.
 *
 * Moved to `@/lib/redact` when the structured logger needed the same rule
 * (ticket 27). Re-exported under the old name because it is part of this
 * module's documented surface and is asserted by name in the audit tests.
 */
export const redactAuditPayload = redact;

export async function writeAuditLog(entry: AuditEntry, session?: ClientSession): Promise<void> {
  const doc: Partial<AuditLogDoc> = {
    action: entry.action,
    actorType: entry.actor.type,
    ...("userId" in entry.actor && entry.actor.userId
      ? { actorUserId: toObjectId(entry.actor.userId) }
      : {}),
    ...(entry.organizationId
      ? { organizationId: toObjectId(entry.organizationId) }
      : "organizationId" in entry.actor && entry.actor.organizationId
        ? { organizationId: toObjectId(entry.actor.organizationId) }
        : {}),
    ...(entry.subject
      ? { subjectType: entry.subject.type, subjectId: toObjectId(entry.subject.id) }
      : {}),
    ...(entry.before ? { before: redactAuditPayload(entry.before) } : {}),
    ...(entry.after ? { after: redactAuditPayload(entry.after) } : {}),
    ...(entry.ip ? { ip: entry.ip } : {}),
    ...(entry.userAgent ? { userAgent: entry.userAgent.slice(0, 400) } : {}),
    ...(entry.source ? { source: entry.source } : {}),
  };

  if (session) {
    // Part of the atomic unit — a failure here must roll the change back.
    await connectToDatabase();
    // `new` + `save` rather than `create()`: Mongoose 9 cannot prove
    // `create([Partial<T>])` for a generic document. Same reason as
    // `BaseRepository.create`.
    await new AuditLog(doc).save({ session });
    return;
  }

  try {
    await connectToDatabase();
    await new AuditLog(doc).save();
  } catch (error) {
    // Best-effort. Losing a read-audit is bad; failing the operation the user
    // asked for because we could not record it is worse.
    log.exception(`Could not record audit entry "${entry.action}"`, error, {
      code: "audit.write_failed",
      action: entry.action,
    });
  }
}

/** Build a staff actor from a DAL `StaffContext`. */
export function staffActor(user: { id: string; name?: string }): AuditActor {
  return { type: "staff", userId: user.id, ...(user.name ? { name: user.name } : {}) };
}

/**
 * The before/after pair for a state transition.
 *
 * A named helper so every transition in the codebase records the same shape,
 * and so nobody is tempted to pass the whole document.
 */
export function statusChange(
  from: string,
  to: string,
  extra: Record<string, unknown> = {},
): Pick<AuditEntry, "before" | "after"> {
  return { before: { status: from }, after: { status: to, ...extra } };
}
