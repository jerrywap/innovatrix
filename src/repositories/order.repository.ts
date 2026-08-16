import type { ClientSession } from "mongoose";
import { OrgScopedRepository } from "./base";
import { toObjectId } from "@/lib/db/base";
import { Order, type OrderDoc } from "@/lib/db/models/commerce";
import type { OrderStatus } from "@/lib/db/enums";

/**
 * Orders — §61.
 *
 * Org-scoped, because an order belongs to an organisation and a customer must
 * never see another's. Staff screens use `OrderRepository` with an explicit
 * scope or the unscoped model, never by relaxing this.
 *
 * Nothing here recomputes a total. Order lines are frozen at creation and the
 * only writes are status transitions and payment linkage.
 */
export class OrderRepository extends OrgScopedRepository<OrderDoc> {
  async findByReference(
    reference: string,
    options: { session?: ClientSession } = {},
  ): Promise<OrderDoc | null> {
    return this.model
      .findOne({ reference })
      .session(options.session ?? null)
      .lean<OrderDoc>();
  }

  /** The idempotency check — see `OrderDoc.idempotencyKey`. */
  async findByIdempotencyKey(
    key: string,
    options: { session?: ClientSession } = {},
  ): Promise<OrderDoc | null> {
    return this.model
      .findOne({ idempotencyKey: key })
      .session(options.session ?? null)
      .lean<OrderDoc>();
  }

  /**
   * Move status only if it is still what the caller read.
   *
   * The same guard as products and versions, and here it is the difference
   * between one fulfilment and two: a webhook and the reconciliation sweep can
   * both decide an order is paid, and only one of them may write it.
   */
  async setStatusIfCurrent(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    extra: Record<string, unknown> = {},
    session?: ClientSession,
  ): Promise<OrderDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: toObjectId(orderId), status: from },
        { $set: { status: to, ...extra } },
        { returnDocument: "after", session: session ?? null },
      )
      .lean<OrderDoc>();
  }

  /**
   * Staff view: every organisation's orders, newest first.
   *
   * Named `listAcrossOrganizations` rather than `listAll`, and it calls the
   * inherited unscoped `list()` on purpose. That inherited method is the one
   * genuine footgun in `OrgScopedRepository` — it exists and it ignores tenancy
   * — so the deliberate use is given a name that cannot be mistaken for the
   * customer-facing one at a call site. `order.view_all` gates it.
   */
  async listAcrossOrganizations(
    options: { status?: OrderStatus; page?: number; limit?: number } = {},
  ) {
    return this.list({
      ...(options.status ? { filter: { status: options.status } } : {}),
      sort: { createdAt: -1 },
      ...(options.page ? { page: options.page } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    });
  }
}

export const orders = new OrderRepository(Order);
