import type { ClientSession } from "mongoose";
import { BaseRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import { DiscountCode, type DiscountCodeDoc } from "@/lib/db/models/commerce";

/**
 * Discount codes — ticket 10.
 *
 * Not org-scoped: a code is a platform-wide lever, and scoping it to an
 * organisation would make "20% off for everyone" impossible to express.
 */
export class DiscountCodeRepository extends BaseRepository<DiscountCodeDoc> {
  /** Lookup is always by code, and the code is always uppercase. */
  async findByCode(
    code: string,
    options: { session?: ClientSession } = {},
  ): Promise<DiscountCodeDoc | null> {
    return this.model
      .findOne({ code: code.trim().toUpperCase() })
      .session(options.session ?? null)
      .lean<DiscountCodeDoc>();
  }

  /**
   * Claim one use, atomically.
   *
   * The filter carries the limit check, so **the database decides who gets the
   * last one**. Reading `usedCount`, comparing it, then incrementing is the
   * obvious version and it lets two customers both take use number 100 of a
   * 100-use code — a bug that only appears under exactly the load a promotion
   * creates.
   *
   * Returns `null` when the code is exhausted, which the caller must treat as
   * a refusal rather than ignore.
   */
  async claimUse(code: string, session?: ClientSession): Promise<DiscountCodeDoc | null> {
    const normalised = code.trim().toUpperCase();

    return this.model
      .findOneAndUpdate(
        {
          code: normalised,
          isActive: true,
          // `$expr` so the comparison is against this document's own fields.
          // A missing `usageLimit` means unlimited, hence the `$ifNull`.
          $expr: {
            $lt: ["$usedCount", { $ifNull: ["$usageLimit", Number.MAX_SAFE_INTEGER] }],
          },
        },
        { $inc: { usedCount: 1 } },
        { returnDocument: "after", session: session ?? null },
      )
      .lean<DiscountCodeDoc>();
  }

  /** Undo a claim — an order that failed after the increment. */
  async releaseUse(code: string, session?: ClientSession): Promise<void> {
    await this.model.updateOne(
      { code: code.trim().toUpperCase(), usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
      { session: session ?? undefined },
    );
  }

  async listActive(limit = 100): Promise<DiscountCodeDoc[]> {
    return this.model
      .find({})
      .sort({ isActive: -1, createdAt: -1 })
      .limit(limit)
      .lean<DiscountCodeDoc[]>();
  }

  async setActive(id: string, isActive: boolean): Promise<DiscountCodeDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(id) },
        { $set: { isActive } },
        { returnDocument: "after" },
      )
      .lean<DiscountCodeDoc>();
  }
}

export const discountCodes = new DiscountCodeRepository(DiscountCode);
