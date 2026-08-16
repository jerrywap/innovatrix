import type { ClientSession } from "mongoose";
import { BaseRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import { Cart, type CartDoc } from "@/lib/db/models/commerce";

/**
 * Carts — §12.
 *
 * `ownerKey` is the whole access story: a guest cookie id, or `user:<id>` once
 * somebody signs in. It is unique, so `findOrCreate` is an upsert rather than a
 * read-then-write with a race in the middle — two tabs adding to an empty cart
 * at the same moment must not produce two carts.
 */
export class CartRepository extends BaseRepository<CartDoc> {
  /** Guest carts live 7 days, signed-in carts 30 (§12). */
  static readonly GUEST_TTL_DAYS = 7;
  static readonly USER_TTL_DAYS = 30;

  async findByOwnerKey(
    ownerKey: string,
    options: { session?: ClientSession } = {},
  ): Promise<CartDoc | null> {
    return this.model
      .findOne({ ownerKey })
      .session(options.session ?? null)
      .lean<CartDoc>();
  }

  /**
   * Get the cart for this owner, creating it if there is none.
   *
   * An upsert, because the alternative — find, then insert if missing — races
   * against itself. The unique index on `ownerKey` would then reject the second
   * insert and the customer would see an error for clicking "add to cart" twice.
   */
  async findOrCreate(
    ownerKey: string,
    defaults: { currency: string; userId?: string; organizationId?: string },
    options: { session?: ClientSession } = {},
  ): Promise<CartDoc> {
    const isUserCart = ownerKey.startsWith("user:");
    const ttlDays = isUserCart ? CartRepository.USER_TTL_DAYS : CartRepository.GUEST_TTL_DAYS;

    const cart = await this.model
      .findOneAndUpdate(
        { ownerKey },
        {
          $setOnInsert: {
            ownerKey,
            currency: defaults.currency,
            items: [],
            ...(defaults.userId ? { userId: toObjectId(defaults.userId) } : {}),
            ...(defaults.organizationId
              ? { organizationId: toObjectId(defaults.organizationId) }
              : {}),
          },
          // Touched on every access, so an actively-used cart never expires
          // mid-session. `$set` rather than `$setOnInsert` for exactly that.
          $set: { expiresAt: new Date(Date.now() + ttlDays * 86_400_000) },
        },
        { upsert: true, returnDocument: "after", session: options.session ?? null },
      )
      .lean<CartDoc>();

    return cart!;
  }

  async replaceItems(
    cartId: string,
    items: CartDoc["items"],
    options: { session?: ClientSession } = {},
  ): Promise<CartDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(cartId) },
        { $set: { items } },
        { returnDocument: "after", session: options.session ?? null },
      )
      .lean<CartDoc>();
  }

  async clear(cartId: string, options: { session?: ClientSession } = {}): Promise<void> {
    await this.model.updateOne(
      { _id: toObjectId(cartId) },
      { $set: { items: [] }, $unset: { discountCode: "" } },
      { session: options.session ?? undefined },
    );
  }

  async deleteByOwnerKey(
    ownerKey: string,
    options: { session?: ClientSession } = {},
  ): Promise<void> {
    await this.model.deleteOne({ ownerKey }, { session: options.session ?? undefined });
  }
}

export const carts = new CartRepository(Cart);
