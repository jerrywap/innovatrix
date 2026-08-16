import "server-only";
import { emit, on } from "@/lib/events";
import { Quote, type QuoteDoc } from "@/lib/db/models/billing";
import { CustomerRequest } from "@/lib/db/models/requests";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { transition } from "@/services/requests/request-service";
import { createFromQuote } from "./invoice-service";

/**
 * `QuoteAccepted` → invoice → work order — §52.
 *
 * ## Why handlers rather than calls inside the services
 *
 * §92's shape: services emit, handlers react. Two consequences that matter:
 *
 * - **Acceptance must not fail because invoicing did.** The event bus isolates
 *   every handler, so a problem raising the invoice leaves the acceptance
 *   standing — which is right, because the customer has agreed either way and
 *   an invoice can be raised again. The reverse (rolling back an acceptance
 *   because a downstream write failed) would silently un-agree a contract.
 * - Ticket 53's project creation subscribes to `WorkReadyToStart` without
 *   touching the invoice service.
 *
 * Both handlers are idempotent, because a re-emitted event must not bill a
 * customer twice or start the same work twice.
 */
export function registerInvoiceHandlers(): void {
  on("QuoteAccepted", async (payload) => {
    await createFromQuote(payload.quoteId, { type: "system" });
  });

  on("InvoicePaid", async (payload) => {
    await convertRequest(payload);
  });
}

/**
 * A settled invoice against a quote means the work is funded — §52.
 *
 * ## The deposit is the trigger, not the balance
 *
 * On deposit terms the whole point is that work starts once the deposit
 * clears. So this fires on the *first* invoice from a quote to be paid, and the
 * status is the guard: the balance invoice arrives later to find a request that
 * is already `converted` and does nothing.
 *
 * Checked rather than left to `transition()` to refuse. The refusal would be
 * correct but it throws, and a handler that throws on the ordinary second
 * payment would fill the log with errors describing normal behaviour.
 */
async function convertRequest(payload: {
  invoiceId: string;
  organizationId: string;
  sourceType: string;
  sourceId: string;
}): Promise<void> {
  // An invoice raised straight from a marketplace order has no request behind
  // it — those fulfil through `processPaymentSucceeded` and are already done.
  if (payload.sourceType !== "quote") return;

  await connectToDatabase();

  const quote = await Quote.findById(toObjectId(payload.sourceId))
    .select({ requestId: 1 })
    .lean<Pick<QuoteDoc, "_id" | "requestId">>();
  if (!quote) return;

  const current = await CustomerRequest.findById(quote.requestId)
    .select({ status: 1 })
    .lean<{ status: string }>();
  if (current?.status !== "approved") return;

  const request = await transition({
    requestId: String(quote.requestId),
    to: "converted",
    actor: { type: "system" },
    note: "Payment received — we're getting started.",
  });

  await emit("WorkReadyToStart", {
    requestId: String(request._id),
    reference: request.reference,
    organizationId: payload.organizationId,
    quoteId: payload.sourceId,
    invoiceId: payload.invoiceId,
  });
}
