import type { ClientSession } from "mongoose";
import { BaseRepository, RepositoryError } from "./base";
import { toObjectId } from "@/lib/db/base";
import type { SubjectType } from "@/lib/db/enums";
import { AuditLog, type AuditLogDoc } from "@/lib/db/models/communication";

/**
 * The audit log — §90, append-only.
 *
 * `update` and `delete` are overridden to throw. That makes append-only a
 * property of the type rather than a rule someone has to know: a service that
 * tries to amend an audit entry fails at the call, and a reviewer does not have
 * to notice.
 *
 * The model's own comment already states the intent ("the repository refuses
 * update and delete"); this is the repository that makes it true.
 *
 * Reading is ordinary — ticket 26's audit viewer and any investigation go
 * through `list`.
 */
export class AuditLogRepository extends BaseRepository<AuditLogDoc> {
  override async updateById(): Promise<never> {
    throw new RepositoryError(
      "The audit log is append-only (§90). An entry cannot be amended — record a " +
        "new one describing the correction instead.",
    );
  }

  override async deleteById(): Promise<never> {
    throw new RepositoryError(
      "The audit log is append-only (§90). Entries are never deleted; retention is " +
        "a database-level concern, not an application one.",
    );
  }

  /** Everything that happened to one thing, newest first. */
  async listForSubject(
    subjectType: SubjectType,
    subjectId: string,
    options: { limit?: number; session?: ClientSession } = {},
  ) {
    return this.list({
      filter: { subjectType, subjectId: toObjectId(subjectId) },
      sort: { createdAt: -1 },
      limit: options.limit ?? 50,
      ...(options.session ? { session: options.session } : {}),
    });
  }
}

export const auditLogs = new AuditLogRepository(AuditLog);
