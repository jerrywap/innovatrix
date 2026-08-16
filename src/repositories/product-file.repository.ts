import type { ClientSession } from "mongoose";
import { BaseRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import { ProductFile, type ProductFileDoc } from "@/lib/db/models/catalog";
import type { ProductFileKind } from "@/lib/db/enums";

/**
 * The artefacts a customer downloads — §44, §66.
 *
 * Every row's `storageKey` is an unguessable object key, never a URL. Nothing
 * here returns a link; downloads go through ticket 14's entitlement check and a
 * short-lived signed URL.
 */
export class ProductFileRepository extends BaseRepository<ProductFileDoc> {
  async listForVersion(
    versionId: string,
    options: { session?: ClientSession } = {},
  ): Promise<ProductFileDoc[]> {
    return this.model
      .find({ versionId: toObjectId(versionId) })
      .sort({ kind: 1, filename: 1 })
      .limit(200)
      .session(options.session ?? null)
      .lean<ProductFileDoc[]>();
  }

  /**
   * Every file across several versions, in one query.
   *
   * The admin version list renders a product's whole release history at once.
   * Calling `listForVersion` per row is the N+1 that turns drawing twenty
   * collapsed panels into twenty-one round trips.
   */
  async listForVersions(versionIds: readonly string[]): Promise<ProductFileDoc[]> {
    if (versionIds.length === 0) return [];

    return this.model
      .find({ versionId: { $in: versionIds.map((id) => toObjectId(id)) } })
      .sort({ kind: 1, filename: 1 })
      .limit(1000)
      .lean<ProductFileDoc[]>();
  }

  async countByKind(versionId: string, kind: ProductFileKind): Promise<number> {
    return this.model.countDocuments({ versionId: toObjectId(versionId), kind });
  }

  /** Has anyone already claimed this object? The unique index is the authority. */
  async findByStorageKey(storageKey: string) {
    return this.findOne({ storageKey });
  }

  /**
   * Which of these products have a downloadable package on a released version.
   *
   * The other half of the admin list's readiness column, and the reason
   * `{ versionId: 1, kind: 1 }` exists as an index. Takes the version ids the
   * caller already resolved rather than joining, so it stays one query.
   */
  async versionIdsWithPackage(versionIds: readonly string[]): Promise<Set<string>> {
    if (versionIds.length === 0) return new Set();

    const rows = await this.model.aggregate<{ _id: unknown }>([
      {
        $match: {
          versionId: { $in: versionIds.map((id) => toObjectId(id)) },
          kind: "application_package",
        },
      },
      { $group: { _id: "$versionId" } },
    ]);

    return new Set(rows.map((row) => String(row._id)));
  }
}

export const productFiles = new ProductFileRepository(ProductFile);
