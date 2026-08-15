import "server-only";
import type {
  ClientSession,
  QueryFilter,
  Model,
  ProjectionType,
  QueryOptions,
  SortOrder,
  UpdateQuery,
} from "mongoose";
import { ORG_SCOPE_FIELD, toObjectId } from "@/lib/db/base";

/**
 * Repository base.
 *
 * Two rules are enforced structurally rather than by review, because both are
 * the kind of mistake that only shows up in production:
 *
 *  1. **Every list is bounded.** §94 forbids loading unbounded sets. `list()`
 *     applies a default limit and caps the maximum, so no caller can ask for
 *     "all products" and get 40,000 documents into memory.
 *
 *  2. **Tenant scope is never optional.** `OrgScopedRepository` refuses to build
 *     a query without an organizationId. Forgetting a `WHERE organization_id`
 *     in SQL is a bug; here it is a cross-tenant data leak.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface ListParams<T> {
  filter?: QueryFilter<T>;
  sort?: Record<string, SortOrder>;
  page?: number;
  limit?: number;
  projection?: ProjectionType<T>;
  session?: ClientSession | undefined;
  includeDeleted?: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryError";
  }
}

export class BaseRepository<T> {
  constructor(protected readonly model: Model<T>) {}

  protected baseFilter(includeDeleted = false): QueryFilter<T> {
    // Only exclude soft-deleted docs on schemas that actually have the field —
    // otherwise the condition silently matches nothing.
    if (includeDeleted || !this.model.schema.path("deletedAt")) return {};
    return { deletedAt: null } as QueryFilter<T>;
  }

  async findById(
    id: string,
    options: { session?: ClientSession | undefined; includeDeleted?: boolean } = {},
  ): Promise<T | null> {
    return this.model
      .findOne({
        _id: toObjectId(id),
        ...this.baseFilter(options.includeDeleted),
      } as QueryFilter<T>)
      .session(options.session ?? null)
      .lean<T>()
      .exec();
  }

  async findOne(
    filter: QueryFilter<T>,
    options: { session?: ClientSession | undefined; includeDeleted?: boolean } = {},
  ): Promise<T | null> {
    return this.model
      .findOne({ ...filter, ...this.baseFilter(options.includeDeleted) })
      .session(options.session ?? null)
      .lean<T>()
      .exec();
  }

  /**
   * Always paginated. `limit` is clamped rather than rejected so a bad caller
   * degrades to a slow page instead of a 500 — but the clamp is real, and
   * asking for 5,000 returns 100.
   */
  async list(params: ListParams<T> = {}): Promise<Paginated<T>> {
    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const requested = Math.trunc(params.limit ?? DEFAULT_PAGE_SIZE);

    if (requested < 1) {
      throw new RepositoryError(`list() limit must be at least 1, received ${requested}.`);
    }
    const limit = Math.min(requested, MAX_PAGE_SIZE);

    const filter = { ...params.filter, ...this.baseFilter(params.includeDeleted) };

    const [items, total] = await Promise.all([
      this.model
        .find(filter, params.projection)
        .sort(params.sort ?? { createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .session(params.session ?? null)
        .lean<T[]>()
        .exec(),
      this.model
        .countDocuments(filter)
        .session(params.session ?? null)
        .exec(),
    ]);

    const pages = Math.max(1, Math.ceil(total / limit));
    return {
      items,
      total,
      page,
      limit,
      pages,
      hasNext: page < pages,
      hasPrevious: page > 1,
    };
  }

  /**
   * Uses the document constructor rather than `Model.create()`.
   *
   * Mongoose 9 types `create()` as `DeepPartial<ApplyBasicCreateCasting<...>>`,
   * which cannot be proven assignable from `Partial<T>` while `T` is still an
   * unresolved generic on this base class. `new this.model(...)` + `save()` is
   * the same two operations with types that resolve, and it returns the
   * hydrated document directly instead of an array we have to unpack.
   */
  async create(data: Partial<T>, session?: ClientSession): Promise<T> {
    const doc = new this.model(data);
    await doc.save({ session: session ?? undefined });
    return doc.toObject() as T;
  }

  async updateById(
    id: string,
    update: UpdateQuery<T>,
    options: { session?: ClientSession | undefined } = {},
  ): Promise<T | null> {
    const queryOptions: QueryOptions<T> = {
      returnDocument: "after",
      runValidators: true,
      session: options.session ?? undefined,
    };
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(id), ...this.baseFilter() } as QueryFilter<T>,
        update,
        queryOptions,
      )
      .lean<T>()
      .exec();
  }

  /** Soft delete where the schema supports it; hard delete otherwise. */
  async deleteById(id: string, session?: ClientSession): Promise<boolean> {
    if (this.model.schema.path("deletedAt")) {
      const result = await this.updateById(
        id,
        { $set: { deletedAt: new Date() } } as UpdateQuery<T>,
        { session },
      );
      return result !== null;
    }
    const result = await this.model
      .deleteOne({ _id: toObjectId(id) } as QueryFilter<T>)
      .session(session ?? null)
      .exec();
    return result.deletedCount === 1;
  }

  async exists(filter: QueryFilter<T>, session?: ClientSession): Promise<boolean> {
    const found = await this.model
      .exists({ ...filter, ...this.baseFilter() })
      .session(session ?? null)
      .exec();
    return found !== null;
  }
}

/**
 * Repository for documents owned by a customer organization.
 *
 * Every read and write takes an explicit `organizationId`, which comes from the
 * session via the DAL (ticket 03) and **never** from client input. Passing a
 * falsy value throws rather than silently querying across tenants.
 */
export class OrgScopedRepository<T> extends BaseRepository<T> {
  protected scope(organizationId: string, filter: QueryFilter<T> = {}): QueryFilter<T> {
    if (!organizationId) {
      throw new RepositoryError(
        `${this.model.modelName}: an organizationId is required. ` +
          `Take it from the session (requireOrg), never from client input.`,
      );
    }
    return {
      ...filter,
      [ORG_SCOPE_FIELD]: toObjectId(organizationId),
    } as QueryFilter<T>;
  }

  async findByIdForOrg(
    id: string,
    organizationId: string,
    options: { session?: ClientSession | undefined } = {},
  ): Promise<T | null> {
    return this.findOne(
      this.scope(organizationId, { _id: toObjectId(id) } as QueryFilter<T>),
      options,
    );
  }

  async listForOrg(
    organizationId: string,
    params: Omit<ListParams<T>, "filter"> & { filter?: QueryFilter<T> } = {},
  ): Promise<Paginated<T>> {
    return this.list({ ...params, filter: this.scope(organizationId, params.filter) });
  }

  async countForOrg(organizationId: string, filter: QueryFilter<T> = {}): Promise<number> {
    return this.model
      .countDocuments({ ...this.scope(organizationId, filter), ...this.baseFilter() })
      .exec();
  }
}
