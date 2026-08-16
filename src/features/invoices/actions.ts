"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { objectIdSchema } from "@/validators/common";
import { requireOrg, requirePermission, requireUser } from "@/lib/auth/dal";
import { ForbiddenError } from "@/lib/errors";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { Invoice, type InvoiceDoc } from "@/lib/db/models/billing";
import { Payment } from "@/lib/db/models/commerce";
import { fromDecimal } from "@/lib/money";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { staffActor, writeAuditLog } from "@/services/audit";
import { createPaymentRecord } from "@/services/payments/payment-service";
import { applyPayment, outstanding, raiseBalance } from "@/services/invoices/invoice-service";

/**
 * Invoice actions — §63.
 *
 * ## Every one of these is a public POST endpoint
 *
 * Which is why each opens with the DAL, and why the customer-facing one scopes
 * by `requireOrg()` rather than trusting the invoice id in the form. An id is a
 * claim about what somebody is allowed to see; the session is the fact.
 */

/* ────────────────────────────────────────────── Pay Now (customer) */

/**
 * Send the customer to a provider for the outstanding balance.
 *
 * Mirrors `placeOrderAction` exactly, including the redirect-outside-the-action
 * shape: `redirect()` throws, and throwing inside `withAction` would be caught
 * and reported as a failure rather than navigating.
 */
export async function payInvoiceAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  let redirectUrl: string | undefined;

  const result = await withAction<never>(async () => {
    const user = await requireUser();
    const { organizationId, role } = await requireOrg();

    // The same roles the screen is gated on. A server action is a public POST
    // endpoint, so the page guard proves nothing here.
    if (!["owner", "admin", "billing"].includes(role)) {
      throw new ForbiddenError("Only billing contacts can pay an invoice.");
    }

    const input = parseInput(
      z.object({ invoiceId: objectIdSchema }),
      parseNestedFormData(formData),
    );

    const { initiatePaymentForInvoice } = await import("@/services/payments/payment-service");

    // Scoped by the session's organisation inside — an invoice id belonging to
    // somebody else is a 404 there, not a payment page here.
    const initiated = await initiatePaymentForInvoice({
      invoiceId: input.invoiceId,
      organizationId,
      customerEmail: user.email,
      ...(user.name ? { customerName: user.name } : {}),
      actor: staffActor({ id: user.id, name: user.name }),
    });

    redirectUrl = initiated.redirectUrl;
    return ok(undefined as never);
  });

  if (!result.ok) return result;

  // External by design — the provider's hosted page. `typedRoutes` cannot type
  // it, and the customer returns to the invoice afterwards.
  if (redirectUrl) redirect(redirectUrl as Route);

  return ok(undefined as never);
}

/* ────────────────────────────────────────────── record a payment (staff) */

const recordSchema = z.object({
  invoiceId: objectIdSchema,
  amount: z.string().trim().min(1),
  currency: z.enum(STOREFRONT_CURRENCIES),
  bankReference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  /** Already in S3 via a presigned PUT — a key, never bytes (see AGENTS.md). */
  evidenceKey: z.string().trim().max(400).optional(),
  evidenceFilename: z.string().trim().max(255).optional(),
  evidenceContentType: z.string().trim().max(120).optional(),
  evidenceSizeBytes: z.coerce.number().int().positive().optional(),
  /** The id the evidence key was minted under; becomes the payment's `_id`. */
  draftId: objectIdSchema.optional(),
});

/**
 * A transfer against an invoice — the second caller of Part A's machinery.
 *
 * ## Not `processPaymentSucceeded`
 *
 * The order path runs fulfilment because an order paid means licences issued.
 * An invoice paid means a *balance moved*, and possibly work starting — which
 * is `InvoicePaid`, emitted by `applyPayment`. Routing this through the order
 * fulfilment path would look for an order that does not exist.
 *
 * Everything else is shared: the same permission, the same evidence upload, the
 * same `assertPaymentProofKey`, the same audit shape.
 */
export async function recordInvoicePaymentAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ recorded: true; outcome: string }>> {
  return withAction(async () => {
    const staff = await requirePermission("payment.record_manual");
    const input = parseInput(recordSchema, parseNestedFormData(formData));

    await connectToDatabase();

    const invoice = await Invoice.findById(toObjectId(input.invoiceId)).lean<InvoiceDoc>();
    if (!invoice) {
      return fail("No invoice with that id.", { code: "NOT_FOUND" });
    }

    // `fromDecimal`, never `× 100` — it refuses a malformed amount rather than
    // producing a plausible wrong number, and it respects the exponent.
    let amount;
    try {
      amount = fromDecimal(input.amount.replace(/,/g, ""), input.currency);
    } catch {
      return fail("That amount isn't a number we can bank.", {
        code: "VALIDATION",
        fieldErrors: { amount: ["Enter an amount like 299.99."] },
      });
    }

    if (amount.amount > outstanding(invoice)) {
      // Caught here too, not only in the service, so the staff member gets a
      // field error on the form rather than a thrown digest.
      return fail("That's more than the invoice has outstanding.", {
        code: "VALIDATION",
        fieldErrors: { amount: ["More than the outstanding balance."] },
      });
    }

    const payment = await createPaymentRecord({
      organizationId: String(invoice.organizationId),
      provider: "manual",
      subjectType: "invoice",
      subjectId: String(invoice._id),
      amount: { amount: amount.amount, currency: amount.currency },
      recordedByUserId: staff.user.id,
      ...(input.draftId ? { id: input.draftId } : {}),
    });

    /*
     * Evidence before the balance moves. If applying the payment then fails,
     * the receipt is still attached to the record — which is what somebody
     * investigating needs. The reverse order loses the proof.
     */
    if (input.evidenceKey) {
      const { assertPaymentProofKey } = await import("@/services/storage");
      const key = assertPaymentProofKey(input.evidenceKey, String(payment._id));

      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            evidence: {
              storageKey: key,
              filename: input.evidenceFilename ?? "receipt",
              ...(input.evidenceContentType ? { contentType: input.evidenceContentType } : {}),
              ...(input.evidenceSizeBytes ? { sizeBytes: input.evidenceSizeBytes } : {}),
              uploadedAt: new Date(),
            },
          },
        },
      );
    }

    const applied = await applyPayment(
      {
        invoiceId: String(invoice._id),
        amount: amount.amount,
        currency: amount.currency,
        paymentReference: payment.reference,
      },
      staffActor(staff.user),
    );

    // Only once the money is recorded. A `succeeded` payment against an invoice
    // whose balance did not move is the mismatch reconciliation exists to find.
    await Payment.updateOne(
      { _id: payment._id },
      { $set: { status: "succeeded", paidAt: new Date(), verifiedAt: new Date() } },
    );

    await writeAuditLog({
      action: "payment.recorded_manually",
      actor: staffActor(staff.user),
      subject: { type: "invoice", id: String(invoice._id) },
      organizationId: String(invoice.organizationId),
      after: {
        reference: payment.reference,
        invoiceReference: invoice.reference,
        amount: amount.amount,
        currency: amount.currency,
        ...(input.bankReference ? { bankReference: input.bankReference } : {}),
        ...(input.note ? { note: input.note } : {}),
        // A boolean, never the key — an audit row is read by more people than
        // the evidence route lets through.
        evidenceAttached: Boolean(input.evidenceKey),
        outcome: applied.outcome,
      },
      source: `manual:${staff.user.id}`,
    });

    revalidatePath("/staff/invoices");
    revalidatePath(`/staff/invoices/${String(invoice._id)}`);
    revalidatePath("/dashboard/invoices");

    return ok({ recorded: true as const, outcome: applied.outcome });
  });
}

/* ────────────────────────────────────────────── raise the balance (staff) */

/**
 * The second invoice on deposit terms, once the work is done.
 *
 * Staff-triggered because nothing else knows when that is — §52 leaves the seam
 * open for ticket 53's project tracking to close.
 */
export async function raiseBalanceInvoiceAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ invoiceId: string; reference: string }>> {
  return withAction(async () => {
    const staff = await requirePermission("invoice.issue");
    const input = parseInput(
      z.object({ quoteId: objectIdSchema }),
      parseNestedFormData(formData),
    );

    const invoice = await raiseBalance(input.quoteId, staffActor(staff.user));

    revalidatePath("/staff/invoices");
    revalidatePath("/dashboard/invoices");

    return ok({ invoiceId: String(invoice._id), reference: invoice.reference });
  });
}
