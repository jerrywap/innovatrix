import type { ClientSession } from "mongoose";
import { BaseRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import { ProductVersion, type ProductVersionDoc } from "@/lib/db/models/catalog";

/**
 * Product versions — §45.
 *
 * No `deletedAt`, so `deleteById` hard-deletes. That is deliberate for a draft
 * version nobody has seen; a **released** version must never be deleted, because
 * an entitlement points at it. `ProductVersionService` is what enforces that.
 */
export class ProductVersionRepository extends BaseRepository<ProductVersionDoc> {
  /** Newest first — the version list is read to find the latest, not the first. */
  async listForProduct(
    productId: string,
    options: { session?: ClientSession } = {},
  ): Promise<ProductVersionDoc[]> {
    return this.model
      .find({ productId: toObjectId(productId) })
      .sort({ releasedAt: -1, createdAt: -1 })
      .limit(200)
      .session(options.session ?? null)
      .lean<ProductVersionDoc[]>();
  }

  /** The unique index is `{productId, version}`, so this is an exact lookup. */
  async findByVersionString(productId: string, version: string) {
    return this.findOne({ productId: toObjectId(productId), version });
  }

  /** Publish readiness: is there anything a customer could actually download? */
  async hasReleased(productId: string): Promise<boolean> {
    return this.exists({ productId: toObjectId(productId), status: "released" });
  }

  /**
   * Move status only if it is still what the caller read.
   *
   * The same guarded update as `ProductRepository.setStatusIfCurrent`, and for
   * the same reason: two administrators clicking Release together would
   * otherwise both succeed, producing two `product_version.released` audit rows
   * and — worse — two `currentVersionId` writes racing each other.
   */
  async setStatusIfCurrent(
    id: string,
    from: ProductVersionDoc["status"],
    to: ProductVersionDoc["status"],
    extra: Record<string, unknown> = {},
    session?: ClientSession,
  ): Promise<ProductVersionDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(id), status: from },
        { $set: { status: to, ...extra } },
        { returnDocument: "after", session: session ?? null },
      )
      .lean<ProductVersionDoc>();
  }

  /**
   * Which of these products have at least one released version.
   *
   * One aggregate for a whole page of the admin list. Asking per row is the
   * N+1 that makes a product list feel slow at exactly the point it matters.
   */
  async productIdsWithReleasedVersion(productIds: readonly string[]): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();

    const rows = await this.model.aggregate<{ _id: unknown }>([
      {
        $match: {
          productId: { $in: productIds.map((id) => toObjectId(id)) },
          status: "released",
        },
      },
      { $group: { _id: "$productId" } },
    ]);

    return new Set(rows.map((row) => String(row._id)));
  }
}

export const productVersions = new ProductVersionRepository(ProductVersion);
