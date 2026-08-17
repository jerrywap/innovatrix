import "server-only";
import type { Types } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { ActivityEvent } from "@/lib/db/models/communication";
import { Download, Entitlement, Order } from "@/lib/db/models/commerce";
import { Invoice, Quote } from "@/lib/db/models/billing";
import { CustomerRequest } from "@/lib/db/models/requests";
import { Organization, OrganizationMember, User } from "@/lib/db/models/identity";
import { Product } from "@/lib/db/models/catalog";
import { formatDateTime, formatDay } from "@/lib/dates";

/**
 * Customer 360 — §33.
 *
 * *"Everything about one customer on one page."* The point is that a staff
 * member on a call should never have to say "let me just check another screen":
 * counters, what they own, what they have asked for, what they owe, and one
 * timeline across all of it.
 *
 * ## The timeline interleaves, and that is the hard part
 *
 * §33 wants true chronological order across orders, requests, quotes, invoices
 * and payments — not five lists side by side. Five lists is the easy version
 * and it does not answer the question staff actually have, which is *"what
 * happened with this customer, in order?"*
 *
 * `activityEvents` already carries every domain event with a timestamp and an
 * organisation, so the interleaved feed is one indexed query rather than five
 * merged in memory. That is the payoff of ticket 19 writing activity from the
 * event bus instead of from each screen.
 */

export interface Customer360 {
  organization: { id: string; name: string; slug: string; since: string };
  primaryContact?: { name: string; email: string };
  counts: {
    openRequests: number;
    ownedProducts: number;
    pendingQuotes: number;
    unpaidInvoices: number;
    orders: number;
    downloads: number;
  };
  software: Array<{ id: string; productName: string; status: string; version?: string }>;
  requests: Array<{ reference: string; title: string; status: string; at: string }>;
  orders: Array<{
    reference: string;
    status: string;
    total?: { amount: number; currency: string };
    at: string;
  }>;
  timeline: Array<{ id: string; message: string; at: string; internal: boolean }>;
}

export async function loadCustomer360(organizationId: string): Promise<Customer360 | null> {
  await connectToDatabase();

  const org = toObjectId(organizationId);
  const organization = await Organization.findById(org).lean<{
    _id: unknown;
    name: string;
    slug: string;
    createdAt?: Date;
  }>();
  if (!organization) return null;

  const [
    openRequests,
    ownedProducts,
    pendingQuotes,
    unpaidInvoices,
    orderCount,
    downloads,
    entitlements,
    requests,
    orders,
    timeline,
    owner,
  ] = await Promise.all([
    CustomerRequest.countDocuments({
      organizationId: org,
      status: {
        $in: [
          "submitted",
          "under_review",
          "waiting_for_customer",
          "technical_review",
          "quoted",
        ],
      },
    }),
    Entitlement.countDocuments({ organizationId: org, status: "active" }),
    Quote.countDocuments({ organizationId: org, status: "issued" }),
    Invoice.countDocuments({ organizationId: org, status: { $in: ["issued", "overdue"] } }),
    Order.countDocuments({ organizationId: org, status: { $ne: "draft" } }),
    Download.countDocuments({ organizationId: org }),

    Entitlement.find({ organizationId: org })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<Array<{ _id: unknown; productId: Types.ObjectId; status: string }>>(),

    CustomerRequest.find({ organizationId: org, status: { $ne: "draft" } })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean<Array<{ reference: string; title: string; status: string; createdAt: Date }>>(),

    Order.find({ organizationId: org, status: { $ne: "draft" } })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean<
        Array<{
          reference: string;
          status: string;
          total?: { amount: number; currency: string };
          createdAt: Date;
        }>
      >(),

    // The interleaved feed. Staff see both visibilities (§37) — this is the
    // internal view, and knowing what the customer was *not* told is part of
    // picking up a conversation.
    ActivityEvent.find({ organizationId: org })
      .sort({ createdAt: -1 })
      .limit(60)
      .lean<Array<{ _id: unknown; message: string; visibility: string; createdAt?: Date }>>(),

    OrganizationMember.findOne({ organizationId: org, role: "owner" }).lean<{
      userId: Types.ObjectId;
    }>(),
  ]);

  const productNames = await Product.find({
    _id: { $in: entitlements.map((entitlement) => entitlement.productId) },
  })
    .select({ name: 1 })
    .lean<{ _id: unknown; name: string }[]>();
  const nameById = new Map(productNames.map((product) => [String(product._id), product.name]));

  const contact = owner
    ? await User.findById(owner.userId).select({ name: 1, email: 1 }).lean<{
        name?: string;
        email: string;
      }>()
    : null;

  return {
    organization: {
      id: String(organization._id),
      name: organization.name,
      slug: organization.slug,
      since: organization.createdAt ? formatDay(organization.createdAt) : "—",
    },
    ...(contact
      ? { primaryContact: { name: contact.name ?? contact.email, email: contact.email } }
      : {}),
    counts: {
      openRequests,
      ownedProducts,
      pendingQuotes,
      unpaidInvoices,
      orders: orderCount,
      downloads,
    },
    software: entitlements.map((entitlement) => ({
      id: String(entitlement._id),
      productName: nameById.get(String(entitlement.productId)) ?? "Unknown product",
      status: entitlement.status,
    })),
    requests: requests.map((request) => ({
      reference: request.reference,
      title: request.title,
      status: request.status,
      at: formatDateTime(request.createdAt),
    })),
    orders: orders.map((order) => ({
      reference: order.reference,
      status: order.status,
      ...(order.total ? { total: order.total } : {}),
      at: formatDateTime(order.createdAt),
    })),
    timeline: timeline.map((event) => ({
      id: String(event._id),
      message: event.message,
      at: event.createdAt ? formatDateTime(event.createdAt) : "",
      internal: event.visibility !== "customer",
    })),
  };
}
