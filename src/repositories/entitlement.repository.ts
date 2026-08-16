import type { ClientSession } from "mongoose";
import { OrgScopedRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import {
  Entitlement,
  Licence,
  type EntitlementDoc,
  type LicenceDoc,
} from "@/lib/db/models/commerce";

/**
 * Entitlements — §64.
 *
 * Org-scoped, and this is one of the places that matters most: an entitlement
 * is proof of purchase, and a cross-tenant read here hands somebody else's
 * software to the wrong customer.
 */
export class EntitlementRepository extends OrgScopedRepository<EntitlementDoc> {
  /** Everything this organisation owns, newest first. */
  async listForOrganization(
    organizationId: string,
    options: { limit?: number } = {},
  ): Promise<EntitlementDoc[]> {
    return this.model
      .find(this.scope(organizationId))
      .sort({ createdAt: -1 })
      .limit(Math.min(options.limit ?? 100, 200))
      .lean<EntitlementDoc[]>();
  }

  /**
   * This organisation's entitlement for one product.
   *
   * `active` first, because a customer who bought, refunded and re-bought has
   * two rows and the live one is the answer.
   */
  async findForProduct(
    organizationId: string,
    productId: string,
    options: { session?: ClientSession } = {},
  ): Promise<EntitlementDoc | null> {
    return this.model
      .findOne(this.scope(organizationId, { productId: toObjectId(productId) }))
      .sort({ status: 1, createdAt: -1 })
      .session(options.session ?? null)
      .lean<EntitlementDoc>();
  }

  async findByIdForOrganization(
    entitlementId: string,
    organizationId: string,
  ): Promise<EntitlementDoc | null> {
    return this.model
      .findOne(this.scope(organizationId, { _id: toObjectId(entitlementId) }))
      .lean<EntitlementDoc>();
  }

  /** Does this order already have entitlements? Ticket 13's idempotency check. */
  async existsForOrder(orderId: string, session?: ClientSession): Promise<boolean> {
    const found = await this.model
      .exists({ orderId: toObjectId(orderId) })
      .session(session ?? null);
    return found !== null;
  }

  async countForOrganization(organizationId: string): Promise<number> {
    return this.model.countDocuments(this.scope(organizationId, { status: "active" }));
  }
}

/**
 * Licences — §65.
 *
 * The key lookup is deliberately **not** org-scoped: the activation endpoint is
 * called by installed software with nothing but a key, and there is no session
 * to scope by. The key itself is the credential, which is why it is 75 bits of
 * CSPRNG with a checksum.
 */
export class LicenceRepository extends OrgScopedRepository<LicenceDoc> {
  async findByKey(key: string, session?: ClientSession): Promise<LicenceDoc | null> {
    return this.model
      .findOne({ key: key.toUpperCase() })
      .session(session ?? null)
      .lean<LicenceDoc>();
  }

  async findByEntitlement(entitlementId: string): Promise<LicenceDoc | null> {
    return this.model.findOne({ entitlementId: toObjectId(entitlementId) }).lean<LicenceDoc>();
  }

  async findManyByEntitlements(entitlementIds: readonly string[]): Promise<LicenceDoc[]> {
    if (entitlementIds.length === 0) return [];

    return this.model
      .find({ entitlementId: { $in: entitlementIds.map((id) => toObjectId(id)) } })
      .limit(200)
      .lean<LicenceDoc[]>();
  }
}

export const entitlements = new EntitlementRepository(Entitlement);
export const licences = new LicenceRepository(Licence);
