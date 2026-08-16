"use server";

import { requireOrg, requireUser } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { Order, type OrderDoc } from "@/lib/db/models/commerce";
import { toObjectId } from "@/lib/db/base";
import type { OrderStatus } from "@/lib/db/enums";

/**
 * What the server says an order's status is — §13, §103.
 *
 * The processing page polls this. It is the **only** thing that decides whether
 * a payment succeeded; arriving back from a provider proves nothing, because the
 * customer controls the URL they land on and the provider's redirect fires
 * before its webhook does.
 *
 * Scoped to the caller's organisation, so polling somebody else's reference
 * returns "unknown" rather than their order's state.
 */
export async function pollOrderStatus(reference: string): Promise<{
  status: OrderStatus | "unknown";
  paid: boolean;
  /** Set once fulfilment has run, so the page can offer the download link. */
  fulfilled: boolean;
}> {
  const user = await requireUser();
  const { organizationId } = await requireOrg();
  void user;

  await connectToDatabase();

  const order = await Order.findOne({
    reference: reference.trim().toUpperCase(),
    organizationId: toObjectId(organizationId),
  })
    .select({ status: 1 })
    .lean<Pick<OrderDoc, "status">>();

  if (!order) return { status: "unknown", paid: false, fulfilled: false };

  return {
    status: order.status,
    paid: order.status === "paid" || order.status === "fulfilled",
    fulfilled: order.status === "fulfilled",
  };
}
