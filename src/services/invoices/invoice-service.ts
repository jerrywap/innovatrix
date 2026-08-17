import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { counterStore } from "@/lib/db/counter-store";
import { Invoice, Quote, type InvoiceDoc, type QuoteDoc } from "@/lib/db/models/billing";
import { ActivityEvent } from "@/lib/db/models/communication";
import { assertTransition, INVOICE_TRANSITIONS } from "@/lib/db/states";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { generateReference } from "@/lib/references";
import { withTransaction } from "@/lib/db/transaction";
import { emit } from "@/lib/events";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import { balanceAmount, depositAmount } from "@/services/quotes/totals";
import { formatDay } from "@/lib/dates";

/**
 * Invoices — §63, §52, §61.
 *
 * ## An invoice snapshots the quote and never looks at it again
 *
 * §61's rule, applied one level further along. The lines, the tax and the total
 * are copied at creation. A quote that is later superseded, re-priced or
 * corrected must not change what somebody has already been invoiced — and
 * "invoice line totals equal the accepted quote's, forever" is a criterion, not
 * an aspiration.
 *
 * ## Partial payment is a state, not an edge case
 *
 * Deposits and instalments are ordinary here. `amountPaid` accumulates and
 * `paid` is reached only when it covers the total, so two half-payments produce
 * `paid` rather than two `partially_paid` writes that never converge.
 */

/* ────────────────────────────────────────────── creation */

export interface FromQuoteResult {
  invoices: InvoiceDoc[];
  /** False when an invoice already existed — the idempotent path. */
  created: boolean;
}

/**
 * `QuoteAccepted` → invoice.
 *
 * ## Deposit terms create **one** invoice now, not two
 *
 * §63 wants a deposit invoice now and a balance invoice raised on completion.
 * Raising both up front would put a balance invoice in the customer's overdue
 * queue for work that has not started — so only the deposit is issued, and the
 * balance is left for staff to raise when the work is done. There is no project
 * tracking to trigger it automatically (that is post-MVP), and this is the seam
 * where it will hook in.
 */
export async function createFromQuote(
  quoteId: string,
  actor: AuditActor,
  session?: ClientSession,
): Promise<FromQuoteResult> {
  await connectToDatabase();

  const run = async (txn: ClientSession) => {
    const quote = await Quote.findById(toObjectId(quoteId)).session(txn).lean<QuoteDoc>();
    if (!quote) throw new NotFoundError("quote", { id: quoteId });

    if (quote.status !== "accepted") {
      throw new ValidationError("Only an accepted quote becomes an invoice.", {
        quote: [`Status is ${quote.status}.`],
      });
    }

    // Idempotent. `QuoteAccepted` may be re-emitted, and a second invoice for
    // one acceptance is a customer billed twice.
    const existing = await Invoice.find({
      sourceType: "quote",
      sourceId: quote._id,
    })
      .session(txn)
      .lean<InvoiceDoc[]>();
    // Already invoiced. Returned rather than raised again, and flagged so the
    // caller does not announce an invoice the customer was told about weeks ago.
    if (existing.length > 0) return { invoices: existing, created: false };

    const deposit =
      quote.paymentTerms === "deposit_balance" && quote.depositBasisPoints
        ? depositAmount(quote.total.amount, quote.depositBasisPoints)
        : undefined;

    const reference = await generateReference(counterStore(txn), "INV");

    const [invoice] = await Invoice.create(
      [
        {
          reference,
          organizationId: quote.organizationId,
          sourceType: "quote",
          sourceId: quote._id,
          portion: deposit ? "deposit" : "full",
          /*
           * The quote's lines, copied. For a deposit the *lines* are still the
           * whole job — what differs is the amount payable now — so they are
           * carried verbatim and the total is the deposit. Rewriting the lines
           * into a single "50% deposit" row would lose what the money is for.
           */
          items: quote.items,
          currency: quote.currency,
          subtotal: quote.subtotal,
          ...(quote.tax ? { tax: quote.tax } : {}),
          total: { amount: deposit ?? quote.total.amount, currency: quote.currency },
          amountPaid: { amount: 0, currency: quote.currency },
          status: "issued",
          issuedAt: new Date(),
          // §63: due date from the payment terms. 14 days is the platform
          // default; a per-organisation term is post-MVP.
          dueAt: new Date(Date.now() + 14 * 86_400_000),
          remindersSentAt: [],
        },
      ],
      { session: txn },
    );

    await ActivityEvent.create(
      [
        {
          organizationId: quote.organizationId,
          subjectType: "invoice",
          subjectId: invoice!._id,
          type: "InvoiceIssued",
          message: `Invoice ${reference} is ready to pay`,
          actorType: "system",
          visibility: "customer",
        },
      ],
      { session: txn },
    );

    await writeAuditLog(
      {
        action: "invoice.issued",
        actor,
        subject: { type: "invoice", id: String(invoice!._id) },
        organizationId: String(quote.organizationId),
        after: {
          reference,
          fromQuote: quote.reference,
          quoteVersion: quote.version,
          portion: deposit ? "deposit" : "full",
          total: deposit ?? quote.total.amount,
          currency: quote.currency,
        },
      },
      txn,
    );

    return { invoices: [invoice!.toObject() as InvoiceDoc], created: true };
  };

  // Joins the caller's transaction when there is one — the quote-acceptance
  // path wants the invoice created or not created with it.
  const result = session ? await run(session) : await withTransaction(run);

  // After the commit, never inside it (§92). A notification handler that throws
  // must not un-issue an invoice.
  if (result.created) {
    for (const invoice of result.invoices) {
      await announce(invoice);
    }
  }

  return result;
}

/** `InvoiceIssued` — §69's "payment required". */
async function announce(invoice: InvoiceDoc): Promise<void> {
  await emit("InvoiceIssued", {
    invoiceId: String(invoice._id),
    reference: invoice.reference,
    organizationId: String(invoice.organizationId),
    portion: invoice.portion ?? "full",
    total: invoice.total.amount,
    currency: invoice.currency,
    ...(invoice.dueAt ? { dueAt: formatDay(invoice.dueAt) } : {}),
  });
}

/**
 * The balance, once the work is done. Raised by staff — there is no project
 * tracking to trigger it, and §52 leaves that seam open deliberately.
 */
export async function raiseBalance(quoteId: string, actor: AuditActor): Promise<InvoiceDoc> {
  await connectToDatabase();

  /*
   * Set inside the transaction, read after it. `withTransaction` may replay the
   * callback on a transient error, which is safe here: the value is derived
   * from the same query each time, so a replay recomputes it rather than
   * accumulating.
   */
  let isNew = false;

  const raised = await withTransaction(async (session) => {
    const quote = await Quote.findById(toObjectId(quoteId)).session(session).lean<QuoteDoc>();
    if (!quote) throw new NotFoundError("quote", { id: quoteId });

    if (!quote.depositBasisPoints) {
      throw new ValidationError("That quote has no balance to raise.", {});
    }

    const already = await Invoice.findOne({
      sourceType: "quote",
      sourceId: quote._id,
      portion: "balance",
    })
      .session(session)
      .lean<InvoiceDoc>();
    if (already) {
      isNew = false;
      return already;
    }
    isNew = true;

    const reference = await generateReference(counterStore(session), "INV");

    const [invoice] = await Invoice.create(
      [
        {
          reference,
          organizationId: quote.organizationId,
          sourceType: "quote",
          sourceId: quote._id,
          portion: "balance",
          items: quote.items,
          currency: quote.currency,
          subtotal: quote.subtotal,
          ...(quote.tax ? { tax: quote.tax } : {}),
          total: {
            amount: balanceAmount(quote.total.amount, quote.depositBasisPoints),
            currency: quote.currency,
          },
          amountPaid: { amount: 0, currency: quote.currency },
          status: "issued",
          issuedAt: new Date(),
          dueAt: new Date(Date.now() + 14 * 86_400_000),
          remindersSentAt: [],
        },
      ],
      { session },
    );

    await writeAuditLog(
      {
        action: "invoice.issued",
        actor,
        subject: { type: "invoice", id: String(invoice!._id) },
        organizationId: String(quote.organizationId),
        after: { reference, portion: "balance", total: invoice!.total.amount },
      },
      session,
    );

    return invoice!.toObject() as InvoiceDoc;
  });

  if (isNew) await announce(raised);
  return raised;
}

/* ────────────────────────────────────────────── payment */

export interface ApplyPaymentResult {
  invoice: InvoiceDoc;
  outcome: "partially_paid" | "paid" | "overpaid";
}

/**
 * Record money against an invoice — §63.
 *
 * ## Overpayment is refused rather than silently accepted
 *
 * An explicit criterion. `amountPaid` exceeding the total is either a duplicate
 * payment or a typo, and both need a person. Quietly banking it produces an
 * invoice reading "£1,200 paid of £1,000" that nobody reconciles — so the
 * payment is refused and reported, and staff decide.
 *
 * ## The guard is on `amountPaid`, not on the status
 *
 * Two payments landing together would both read `partially_paid`, both compute
 * a new total from the same stale figure, and the second would overwrite the
 * first. `$inc` plus a guarded read makes the database do the arithmetic.
 */
export async function applyPayment(
  input: {
    invoiceId: string;
    amount: number;
    currency: string;
    paymentReference: string;
  },
  actor: AuditActor,
  session?: ClientSession,
): Promise<ApplyPaymentResult> {
  await connectToDatabase();

  const run = async (txn: ClientSession): Promise<ApplyPaymentResult> => {
    const invoice = await Invoice.findById(toObjectId(input.invoiceId))
      .session(txn)
      .lean<InvoiceDoc>();
    if (!invoice) throw new NotFoundError("invoice", { id: input.invoiceId });

    if (invoice.currency !== input.currency) {
      throw new ValidationError("That payment is in a different currency.", {
        amount: [`Invoice is in ${invoice.currency}.`],
      });
    }

    const after = invoice.amountPaid.amount + input.amount;

    if (after > invoice.total.amount) {
      throw new ValidationError(
        "That would pay more than the invoice is for, so nothing was recorded.",
        { amount: ["More than the outstanding balance."] },
      );
    }

    const to = after >= invoice.total.amount ? "paid" : "partially_paid";
    assertTransition("invoice", INVOICE_TRANSITIONS, invoice.status, to);

    const updated = await Invoice.findOneAndUpdate(
      // Guarded on the figure we read, so two concurrent payments cannot both
      // compute from the same stale `amountPaid`.
      { _id: invoice._id, "amountPaid.amount": invoice.amountPaid.amount },
      {
        $set: {
          status: to,
          "amountPaid.amount": after,
          ...(to === "paid" ? { paidAt: new Date() } : {}),
        },
      },
      { returnDocument: "after", session: txn },
    ).lean<InvoiceDoc>();

    if (!updated) {
      throw new ValidationError("Another payment landed at the same time. Try again.", {});
    }

    await ActivityEvent.create(
      [
        {
          organizationId: updated.organizationId,
          subjectType: "invoice",
          subjectId: updated._id,
          type: "PaymentReceived",
          message:
            to === "paid"
              ? `Invoice ${updated.reference} is paid in full`
              : `Part payment received against invoice ${updated.reference}`,
          actorType: "system",
          visibility: "customer",
        },
      ],
      { session: txn },
    );

    await writeAuditLog(
      {
        action: "invoice.payment_applied",
        actor,
        subject: { type: "invoice", id: String(updated._id) },
        organizationId: String(updated.organizationId),
        before: { amountPaid: invoice.amountPaid.amount, status: invoice.status },
        after: {
          amountPaid: after,
          status: to,
          paymentReference: input.paymentReference,
        },
      },
      txn,
    );

    return { invoice: updated, outcome: to };
  };

  const result = session ? await run(session) : await withTransaction(run);

  if (result.outcome === "paid") {
    /*
     * §52's work-order seam. Post-MVP ticket 53 (projects) subscribes to this;
     * for now it exists so the moment "the customer has paid and work can
     * start" is a named event rather than something inferred later from an
     * invoice status by whoever needs it next.
     */
    await emit("InvoicePaid", {
      invoiceId: String(result.invoice._id),
      reference: result.invoice.reference,
      organizationId: String(result.invoice.organizationId),
      sourceType: result.invoice.sourceType,
      sourceId: String(result.invoice.sourceId),
      total: result.invoice.total.amount,
      currency: result.invoice.currency,
    });
  }

  return result;
}

/** Outstanding balance, for the pay screen and Customer 360. */
export function outstanding(invoice: Pick<InvoiceDoc, "total" | "amountPaid">): number {
  return Math.max(invoice.total.amount - invoice.amountPaid.amount, 0);
}
