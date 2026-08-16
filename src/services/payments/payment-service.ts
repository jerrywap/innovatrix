import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { counterStore } from "@/lib/db/counter-store";
import { generateReference } from "@/lib/references";
import { Order, Payment, type OrderDoc, type PaymentDoc } from "@/lib/db/models/commerce";
import type { InvoiceStatus, PaymentProvider as ProviderKey } from "@/lib/db/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { CurrencyCode } from "@/lib/money";
import { serverEnv } from "@/config/env";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import { payments } from "@/repositories/payment.repository";
import { resolveProvider } from "./registry";

/**
 * Starting a payment — §62.
 *
 * ## Our record exists before the provider is told anything
 *
 * `Payment` is written first, with a reference, and only then does the driver
 * get called. The order matters: the reference is what every driver echoes into
 * provider metadata, so it has to exist before the call — and if the call then
 * fails, we are left with a `pending` payment that reconciliation can chase
 * rather than a charge nobody has a record of.
 *
 * ## Re-initiating is not a second charge
 *
 * A customer who abandons and comes back gets the *same* pending payment
 * re-initiated rather than a new one. Two pending payments against one order is
 * how a double charge starts.
 */

export interface InitiatePaymentResult {
  payment: PaymentDoc;
  redirectUrl: string;
  provider: ProviderKey;
}

export async function initiatePaymentForOrder(input: {
  orderReference: string;
  organizationId: string;
  customerEmail: string;
  customerName?: string;
  preferredProvider?: ProviderKey;
  actor: AuditActor;
}): Promise<InitiatePaymentResult> {
  await connectToDatabase();

  const order = await Order.findOne({
    reference: input.orderReference,
    organizationId: toObjectId(input.organizationId),
  }).lean<OrderDoc>();

  if (!order) throw new NotFoundError("order", { reference: input.orderReference });

  if (order.status !== "awaiting_payment") {
    throw new ConflictError(
      order.status === "paid" || order.status === "fulfilled"
        ? "That order has already been paid."
        : `That order is ${order.status.replace(/_/g, " ")} and cannot be paid.`,
    );
  }

  if (order.total.amount <= 0) {
    throw new ValidationError("There's nothing to pay on that order.", {
      total: ["Order total is zero."],
    });
  }

  const currency = order.currency as CurrencyCode;
  const { driver, key } = await resolveProvider(currency, input.preferredProvider);

  // Reuse a pending payment for the same provider rather than minting another.
  const existing = (await payments.findForSubject(String(order._id))).find(
    (candidate) => candidate.status === "pending" && candidate.provider === key,
  );

  const payment =
    existing ??
    (await createPaymentRecord({
      organizationId: input.organizationId,
      provider: key,
      subjectId: String(order._id),
      amount: { amount: order.total.amount, currency },
    }));

  const returnUrl = `${serverEnv().APP_URL.replace(/\/$/, "")}/checkout/processing?order=${order.reference}`;

  const initiated = await driver.initiate({
    payment,
    amount: { amount: order.total.amount, currency },
    customer: {
      email: input.customerEmail,
      ...(input.customerName ? { name: input.customerName } : {}),
      organizationId: input.organizationId,
    },
    description: `Innovatrix order ${order.reference}`,
    returnUrl,
    metadata: { order_reference: order.reference },
  });

  // Written after the call, because it is the call that produces it. A failure
  // between the two leaves `providerRef` as the placeholder — which is exactly
  // why every driver also echoes `payment.reference` into provider metadata.
  await Payment.updateOne(
    { _id: payment._id },
    { $set: { providerRef: initiated.providerRef } },
  );

  await writeAuditLog({
    action: "payment.initiated",
    actor: input.actor,
    subject: { type: "order", id: String(order._id) },
    organizationId: input.organizationId,
    after: {
      reference: payment.reference,
      provider: key,
      amount: order.total.amount,
      currency,
    },
    source: "checkout",
  });

  return {
    payment: { ...payment, providerRef: initiated.providerRef },
    redirectUrl: initiated.redirectUrl,
    provider: key,
  };
}

/**
 * Create the `pending` record.
 *
 * `providerRef` is required by the schema and unknown until the driver
 * responds, so it starts as the payment's own reference. That is not a
 * placeholder in the sloppy sense: it is unique, so the
 * `(provider, providerRef)` index still protects us, and it is the value the
 * metadata echo will carry if the real ref never lands.
 */
export async function createPaymentRecord(input: {
  organizationId: string;
  provider: ProviderKey;
  subjectId: string;
  subjectType?: "order" | "invoice";
  amount: { amount: number; currency: string };
  recordedByUserId?: string;
  /**
   * Force the `_id`, for the manual path only.
   *
   * A receipt is uploaded *before* the payment exists — the staff member picks
   * the file, then submits. The key is therefore minted under a client-supplied
   * draft id, and `assertPaymentProofKey` later checks it against the payment's
   * own id. Those two are the same id only if this is honoured.
   *
   * Nothing else passes it. A provider payment's id is ours to choose and there
   * is no reason to let a caller pick.
   */
  id?: string;
}): Promise<PaymentDoc> {
  await connectToDatabase();

  const reference = await generateReference(counterStore(), "PAY");

  const created = await Payment.create({
    ...(input.id ? { _id: toObjectId(input.id) } : {}),
    reference,
    organizationId: toObjectId(input.organizationId),
    provider: input.provider,
    providerRef: reference,
    subjectType: input.subjectType ?? "order",
    subjectId: toObjectId(input.subjectId),
    amount: input.amount,
    status: "pending",
    ...(input.recordedByUserId ? { recordedByUserId: toObjectId(input.recordedByUserId) } : {}),
  });

  return created.toObject() as PaymentDoc;
}

/* ────────────────────────────────────────────── invoices (§63) */

/**
 * Pay Now, on an invoice.
 *
 * ## The same abstraction, a different subject
 *
 * `resolveProvider`, `createPaymentRecord` and the driver contract are all
 * reused verbatim — the only thing that differs is what the payment is *for*,
 * which the `Payment` model already models as `subjectType`. A second
 * initiate-and-redirect implementation would be a second place for the
 * reference-echo, the pending-payment reuse and the return URL to drift.
 *
 * ## The amount is the outstanding balance, not the invoice total
 *
 * A deposit invoice part-paid by transfer still has a balance that can be
 * cleared by card. Charging the total would take money the customer does not
 * owe, and `applyPayment` would then refuse to record it — money taken and not
 * banked, which is the worst of the available failures.
 */
export async function initiatePaymentForInvoice(input: {
  invoiceId: string;
  organizationId: string;
  customerEmail: string;
  customerName?: string;
  preferredProvider?: ProviderKey;
  actor: AuditActor;
}): Promise<InitiatePaymentResult> {
  await connectToDatabase();

  const { Invoice } = await import("@/lib/db/models/billing");
  const { outstanding } = await import("@/services/invoices/invoice-service");

  const invoice = await Invoice.findOne({
    _id: toObjectId(input.invoiceId),
    organizationId: toObjectId(input.organizationId),
  }).lean<import("@/lib/db/models/billing").InvoiceDoc>();

  if (!invoice) throw new NotFoundError("invoice", { id: input.invoiceId });

  // Payable states, from `INVOICE_TRANSITIONS`: anything that can still reach
  // `paid`. Listing them positively means a status added later is refused by
  // default rather than silently accepting money.
  const payable: InvoiceStatus[] = ["issued", "partially_paid", "overdue"];

  if (!payable.includes(invoice.status)) {
    throw new ConflictError(
      invoice.status === "paid"
        ? "That invoice has already been paid."
        : `That invoice is ${invoice.status} and cannot be paid.`,
    );
  }

  const due = outstanding(invoice);
  if (due <= 0) {
    throw new ValidationError("There's nothing left to pay on that invoice.", {
      total: ["Nothing outstanding."],
    });
  }

  const currency = invoice.currency as CurrencyCode;
  const { driver, key } = await resolveProvider(currency, input.preferredProvider);

  /*
   * Reuse a pending payment only when it is still for the right money. An
   * invoice's outstanding balance moves — a transfer lands between the customer
   * opening the page and coming back — and re-initiating a stale amount would
   * charge them for a balance that no longer exists.
   */
  const existing = (await payments.findForSubject(String(invoice._id))).find(
    (candidate) =>
      candidate.status === "pending" &&
      candidate.provider === key &&
      candidate.amount.amount === due,
  );

  const payment =
    existing ??
    (await createPaymentRecord({
      organizationId: input.organizationId,
      provider: key,
      subjectType: "invoice",
      subjectId: String(invoice._id),
      amount: { amount: due, currency },
    }));

  const returnUrl = `${serverEnv().APP_URL.replace(/\/$/, "")}/dashboard/invoices/${String(invoice._id)}`;

  const initiated = await driver.initiate({
    payment,
    amount: { amount: due, currency },
    customer: {
      email: input.customerEmail,
      ...(input.customerName ? { name: input.customerName } : {}),
      organizationId: input.organizationId,
    },
    description: `Innovatrix invoice ${invoice.reference}`,
    returnUrl,
    metadata: { invoice_reference: invoice.reference },
  });

  await Payment.updateOne(
    { _id: payment._id },
    { $set: { providerRef: initiated.providerRef } },
  );

  await writeAuditLog({
    action: "payment.initiated",
    actor: input.actor,
    subject: { type: "invoice", id: String(invoice._id) },
    organizationId: input.organizationId,
    after: {
      reference: payment.reference,
      provider: key,
      amount: due,
      currency,
      invoiceReference: invoice.reference,
    },
    source: "invoice",
  });

  return {
    payment: { ...payment, providerRef: initiated.providerRef },
    redirectUrl: initiated.redirectUrl,
    provider: key,
  };
}
