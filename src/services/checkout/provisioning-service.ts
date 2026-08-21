import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { Order, type OrderDoc, type OrderItem } from "@/lib/db/models/commerce";
import { ADDON_PROVISIONING_TRANSITIONS, assertTransition } from "@/lib/db/states";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { VendorScope } from "@/lib/auth/scope";
import { emit } from "@/lib/events";
import { writeAuditLog, type AuditActor } from "@/services/audit";

/**
 * Paid plugins, and the obligation buying one creates.
 *
 * ## What a plugin is here
 *
 * A plugin is sold as an **add-on** on a product and delivered *off* this
 * platform. A free ecommerce script might need a paid Stripe-gateway plugin; what
 * the customer receives is a key, a licence code, or a premium account on a
 * third-party API the script already talks to. There is no artefact, no
 * entitlement and no download — `fulfilment.ts` deliberately issues none for an
 * add-on line and that has not changed.
 *
 * So "delivered" cannot be inferred from anything the platform holds. It has to
 * be recorded, which is what `OrderItem.provisioning` is for and what this
 * module moves.
 *
 * ## The vendor is given a line, not a person
 *
 * A vendor never learns who bought their product — there is no orders or
 * customers screen under `/dashboard/selling`, and that is deliberate. So a
 * vendor cannot email a key to a customer even if they wanted to. They mark the
 * **line** provided and say what they are handing over; the message goes into the
 * thread the customer already reads, and the platform is the only thing that
 * knows both halves.
 *
 * That is also why `markProvided` requires a body. A task that can be closed
 * silently is one that gets closed without the key being sent.
 */

export interface PendingProvisioning {
  orderId: string;
  orderReference: string;
  organizationId: string;
  lineId: string;
  addonName: string;
  productName: string;
  vendorId?: string;
  amount: number;
  currency: string;
  paidAt?: Date;
}

/**
 * Everything still owed, newest order first.
 *
 * `paidAt: { $exists: true }` rather than a status list: a refund drives a
 * pending line to `cancelled`, so "pending **and** paid for" is exactly the open
 * set, and it stays correct if the order status vocabulary grows.
 *
 * Two scopes, and the difference is not cosmetic. A vendor sees their own lines;
 * a staff caller with no `vendorId` sees the **first-party** ones — not
 * everybody's. Staff seeing a vendor's queue would be staff doing a vendor's job
 * without the vendor knowing it was taken off them.
 */
export async function listPending(
  scope: VendorScope | { firstPartyOnly: true },
  limit = 50,
): Promise<PendingProvisioning[]> {
  await connectToDatabase();

  const lineMatch: Record<string, unknown> = {
    kind: "addon",
    "provisioning.status": "pending",
  };

  if ("firstPartyOnly" in scope) {
    lineMatch.vendorId = { $exists: false };
  } else if (scope.vendorId !== undefined) {
    if (scope.vendorId.trim() === "") {
      // The same refusal `vendorFilter` makes, for the same reason: a blank
      // string would widen this to every vendor's queue.
      throw new ValidationError("An empty vendorId is not a scope.");
    }
    lineMatch.vendorId = toObjectId(scope.vendorId);
  }

  const orders = await Order.find({
    items: { $elemMatch: lineMatch },
    paidAt: { $exists: true },
  })
    .sort({ paidAt: -1 })
    // §94 — no unbounded read, even on a queue that should be short.
    .limit(Math.min(Math.max(1, limit), 200))
    .lean<OrderDoc[]>();

  const rows: PendingProvisioning[] = [];

  for (const order of orders) {
    for (const item of order.items) {
      if (item.kind !== "addon") continue;
      if (item.provisioning?.status !== "pending") continue;

      // The document-level `$elemMatch` proves *some* line matched; each line
      // still has to be checked against the scope, or a vendor would see the
      // other vendor's plugin on a two-vendor order.
      if ("firstPartyOnly" in scope) {
        if (item.vendorId) continue;
      } else if (scope.vendorId !== undefined && String(item.vendorId) !== scope.vendorId) {
        continue;
      }

      rows.push({
        orderId: String(order._id),
        orderReference: order.reference,
        organizationId: String(order.organizationId),
        lineId: item.lineId,
        addonName: item.addonName ?? item.productName,
        productName: item.productName,
        ...(item.vendorId ? { vendorId: String(item.vendorId) } : {}),
        amount: item.lineTotal.amount,
        currency: item.lineTotal.currency,
        ...(order.paidAt ? { paidAt: order.paidAt } : {}),
      });
    }
  }

  return rows;
}

/**
 * Emit one request per plugin on a freshly paid order.
 *
 * Called **after** the fulfilment transaction commits — never inside it, per the
 * dispatch-after-commit rule in `lib/events`. A duplicate webhook short-circuits
 * at `already_processed` well before it reaches here, so this does not need its
 * own idempotency.
 */
export async function requestProvisioning(order: OrderDoc): Promise<void> {
  const lines = order.items.filter(
    (item) => item.kind === "addon" && item.provisioning?.status === "pending",
  );

  for (const item of lines) {
    await emit("AddonProvisioningRequested", {
      orderId: String(order._id),
      orderReference: order.reference,
      orderLineId: item.lineId,
      organizationId: String(order.organizationId),
      addonName: item.addonName ?? item.productName,
      productName: item.productName,
      ...(item.vendorId ? { vendorId: String(item.vendorId) } : {}),
      currency: item.lineTotal.currency,
      amount: item.lineTotal.amount,
    });
  }
}

/**
 * A refund cancels anything not yet handed over.
 *
 * Runs inside the refund transaction, beside the entitlement suspension, so a
 * reversed payment cannot leave an open obligation behind. Only `pending` lines
 * move: refunding a plugin whose key has already been sent is a conversation, not
 * a state change, which is why `provided` has no outbound edge.
 */
export async function cancelProvisioning(
  order: Pick<OrderDoc, "_id">,
  session?: ClientSession,
): Promise<{ cancelled: number }> {
  const result = await Order.updateOne(
    { _id: order._id },
    { $set: { "items.$[line].provisioning.status": "cancelled" } },
    {
      arrayFilters: [{ "line.provisioning.status": "pending" }],
      ...(session ? { session } : {}),
    },
  );

  return { cancelled: result.modifiedCount };
}

/**
 * Mark a plugin handed over.
 *
 * The `body` is what the customer receives, and it is **required** — see the
 * module comment. It is posted to the thread by the caller, which is where a
 * credential is allowed to exist; nothing about it is written to the order.
 */
export async function markProvided(
  input: { orderReference: string; lineId: string },
  scope: VendorScope | { firstPartyOnly: true },
  actor: AuditActor & { userId?: string },
): Promise<{ order: OrderDoc; line: OrderItem }> {
  await connectToDatabase();

  const order = await Order.findOne({ reference: input.orderReference }).lean<OrderDoc>();
  if (!order) throw new NotFoundError("order", { reference: input.orderReference });

  const line = order.items.find((item) => item.lineId === input.lineId);
  if (!line) throw new NotFoundError("order line", { lineId: input.lineId });

  if (line.kind !== "addon") {
    throw new ValidationError("Only a plugin line can be provided.", {
      lineId: ["That line is a licence, not a plugin."],
    });
  }

  /*
   * Ownership, from the session's scope and never from the request.
   *
   * A vendor may only touch a line their own product sold. Checking
   * `line.vendorId` rather than the order's is the whole point: one order can
   * carry two vendors' products.
   */
  if ("firstPartyOnly" in scope) {
    if (line.vendorId) {
      throw new NotFoundError("order line", { lineId: input.lineId });
    }
  } else if (scope.vendorId !== undefined && String(line.vendorId) !== scope.vendorId) {
    // `NotFoundError`, not `ForbiddenError`: whether another vendor's line
    // exists on this order is not this vendor's business either.
    throw new NotFoundError("order line", { lineId: input.lineId });
  }

  assertTransition(
    "addonProvisioning",
    ADDON_PROVISIONING_TRANSITIONS,
    line.provisioning?.status ?? "pending",
    "provided",
  );

  /*
   * Guarded update — the status is in the filter, not just the assertion above.
   *
   * Two tabs, or a vendor and a staff member at once, would both pass the
   * assertion on the same document read. The filter makes the second write a
   * no-op, and a zero `modifiedCount` is how we find out.
   */
  const result = await Order.updateOne(
    {
      _id: order._id,
      items: { $elemMatch: { lineId: input.lineId, "provisioning.status": "pending" } },
    },
    {
      $set: {
        "items.$[line].provisioning": {
          status: "provided",
          providedAt: new Date(),
          ...(actor.userId ? { providedByUserId: toObjectId(actor.userId) } : {}),
        },
      },
    },
    { arrayFilters: [{ "line.lineId": input.lineId }] },
  );

  if (result.modifiedCount === 0) {
    throw new ConflictError("That plugin has already been marked provided.");
  }

  await writeAuditLog({
    action: "addon.provisioned",
    actor,
    subject: { type: "order", id: String(order._id) },
    organizationId: String(order.organizationId),
    // The addon and the line, never the body — the body is the credential.
    after: { lineId: input.lineId, addonName: line.addonName },
    source: "provisioning",
  });

  await emit("AddonProvisioned", {
    orderId: String(order._id),
    orderReference: order.reference,
    orderLineId: input.lineId,
    organizationId: String(order.organizationId),
    addonName: line.addonName ?? line.productName,
    productName: line.productName,
  });

  return { order, line };
}
