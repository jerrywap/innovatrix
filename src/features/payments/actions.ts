"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { objectIdSchema } from "@/validators/common";
import { requirePermission } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { PAYMENT_PROVIDERS } from "@/lib/db/enums";
import { Order, Payment, PaymentSettings } from "@/lib/db/models/commerce";
import { fromDecimal } from "@/lib/money";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { staffActor, writeAuditLog } from "@/services/audit";
import { createPaymentRecord } from "@/services/payments/payment-service";
import { processPaymentSucceeded } from "@/services/payments/fulfilment";

/**
 * Payment configuration — §62, §88, §90.
 *
 * ## There is no input here that accepts a secret
 *
 * The schemas below take an enabled flag, a mode, and a routing table. That is
 * all. A key cannot be written into MongoDB through this action because there
 * is no field for one — which is a stronger guarantee than validating that
 * somebody did not paste one.
 */

const providerKeySchema = z.enum(PAYMENT_PROVIDERS);

const toggleSchema = z.object({
  provider: providerKeySchema,
  enabled: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((value) => value === "on" || value === "true" || value === true),
  mode: z.enum(["test", "live"]).default("test"),
});

const routingSchema = z.object({
  currency: z.enum(STOREFRONT_CURRENCIES),
  primary: providerKeySchema,
  fallbacks: z
    .union([providerKeySchema, z.array(providerKeySchema)])
    .optional()
    .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value])),
});

export async function toggleProviderAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("payment_provider.configure");
    const input = parseInput(toggleSchema, parseNestedFormData(formData));

    await connectToDatabase();

    // `arrayFilters` rather than a read-modify-write: two admins on the screen
    // at once must not have one silently overwrite the other's provider.
    const result = await PaymentSettings.updateOne(
      { singleton: "global" },
      {
        $set: {
          "providers.$[target].enabled": input.enabled,
          "providers.$[target].mode": input.mode,
          updatedByUserId: toObjectId(staff.user.id),
        },
      },
      { arrayFilters: [{ "target.key": input.provider }] },
    );

    if (result.matchedCount === 0) {
      // The settings document is created on first read, so this means the
      // provider row is missing — a driver added since the document was made.
      await PaymentSettings.updateOne(
        { singleton: "global" },
        {
          $push: {
            providers: {
              key: input.provider,
              enabled: input.enabled,
              mode: input.mode,
              supportedCurrencies: [],
            },
          },
        },
        { upsert: true },
      );
    }

    await writeAuditLog({
      action: "payment_settings.provider_changed",
      actor: staffActor(staff.user),
      after: { provider: input.provider, enabled: input.enabled, mode: input.mode },
    });

    revalidatePath("/admin/settings/payments");
    return ok({ saved: true as const });
  });
}

export async function setCurrencyRoutingAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("payment_provider.configure");
    const input = parseInput(routingSchema, parseNestedFormData(formData));

    await connectToDatabase();

    // Pull then push, so re-routing a currency replaces its row rather than
    // appending a second one the resolver would then pick between arbitrarily.
    await PaymentSettings.updateOne(
      { singleton: "global" },
      { $pull: { currencyRouting: { currency: input.currency } } },
    );
    await PaymentSettings.updateOne(
      { singleton: "global" },
      {
        $push: {
          currencyRouting: {
            currency: input.currency,
            primary: input.primary,
            fallbacks: input.fallbacks.filter((key) => key !== input.primary),
          },
        },
        $set: { updatedByUserId: toObjectId(staff.user.id) },
      },
      { upsert: true },
    );

    await writeAuditLog({
      action: "payment_settings.routing_changed",
      actor: staffActor(staff.user),
      after: {
        currency: input.currency,
        primary: input.primary,
        fallbacks: input.fallbacks,
      },
    });

    revalidatePath("/admin/settings/payments");
    return ok({ saved: true as const });
  });
}

/* ────────────────────────────────────────────── manual payments (§7.9) */

const manualPaymentSchema = z.object({
  orderReference: z.string().trim().min(1).max(40),
  amount: z.string().trim().min(1),
  currency: z.enum(STOREFRONT_CURRENCIES),
  paidAt: z.string().trim().optional(),
  bankReference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  /**
   * The uploaded receipt, already in S3 via a presigned PUT.
   *
   * A key, not bytes: the browser uploaded it directly (see AGENTS.md — bytes
   * never pass through this server). It is validated against the payment's own
   * prefix before being stored, because a key that arrives from a client is a
   * claim about where something is, not a fact.
   */
  evidenceKey: z.string().trim().max(400).optional(),
  evidenceFilename: z.string().trim().max(255).optional(),
  evidenceContentType: z.string().trim().max(120).optional(),
  evidenceSizeBytes: z.coerce.number().int().positive().optional(),
  /**
   * The id the evidence key was minted under. Becomes the payment's `_id`, so
   * `assertPaymentProofKey` has something to check the key against.
   */
  draftId: objectIdSchema.optional(),
});

/**
 * Record a bank transfer against an order — §7.9.
 *
 * ## This creates real licences without a provider confirming anything
 *
 * Which is why it has its own permission, why the amount is entered in **major
 * units and converted through `fromDecimal`** (never `× 100`), and why it is
 * audited with the staff member's id in the source.
 *
 * It runs the **identical** fulfilment path as a card payment. Not a parallel
 * one: entitlements, licences, the cart clear and the activity event all come
 * out the same, because there is one `processPaymentSucceeded`.
 */
export async function recordManualPaymentAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ recorded: true; orderReference: string }>> {
  return withAction(async () => {
    const staff = await requirePermission("payment.record_manual");
    const input = parseInput(manualPaymentSchema, parseNestedFormData(formData));

    await connectToDatabase();

    const order = await Order.findOne({
      reference: input.orderReference.toUpperCase(),
    }).lean<{
      _id: unknown;
      organizationId: unknown;
      total: { amount: number; currency: string };
    }>();

    if (!order) {
      return fail(`No order found with reference ${input.orderReference}.`, {
        code: "NOT_FOUND",
        fieldErrors: { orderReference: ["Unknown reference."] },
      });
    }

    // `fromDecimal`, never `× 100` — it throws a `MoneyError` on a malformed
    // amount rather than producing a plausible wrong number, and it respects
    // the currency's own exponent.
    let amount;
    try {
      amount = fromDecimal(input.amount.replace(/,/g, ""), input.currency);
    } catch {
      return fail("That amount isn't a number we can bank.", {
        code: "VALIDATION",
        fieldErrors: { amount: ["Enter an amount like 299.99."] },
      });
    }

    const payment = await createPaymentRecord({
      organizationId: String(order.organizationId),
      provider: "manual",
      subjectId: String(order._id),
      amount: { amount: amount.amount, currency: amount.currency },
      recordedByUserId: staff.user.id,
      ...(input.draftId ? { id: input.draftId } : {}),
    });

    /*
     * Attach the receipt before fulfilling.
     *
     * Order matters: if fulfilment fails the evidence is still on the payment
     * record, which is what somebody investigating needs. The reverse order
     * would leave a fulfilled order whose proof went missing because a second
     * write failed.
     *
     * `assertPaymentProofKey` is the check that the key belongs to *this*
     * payment. Without it a client could hand back a key pointing at another
     * customer's banking and have us attach it here.
     */
    if (input.evidenceKey) {
      const { assertPaymentProofKey, verifyUpload } = await import("@/services/storage");
      const key = assertPaymentProofKey(input.evidenceKey, String(payment._id));

      /*
       * Sniff the bytes — ticket 26.
       *
       * `assertPaymentProofKey` proves the key belongs to this payment. It says
       * nothing about what is *at* the key, and the browser uploaded that
       * directly to S3 with a presigned PUT: the declared content type came
       * from the client and nothing has read the object since.
       *
       * So a `.exe` renamed `receipt.pdf` was stored, recorded on the payment,
       * and later served through the evidence route to a staff member who
       * clicked it expecting a receipt. `verifyUpload` HEADs it, checks the
       * size and type against what was signed, range-reads the first 4KB and
       * rejects an executable — deleting the object on the way out.
       *
       * The 4KB read is the *only* place bytes touch this server, and they
       * never reach a client (AGENTS.md).
       *
       * Product files have had this since ticket 07. Payment evidence and
       * request attachments did not, which meant the one upload path a
       * *stranger* can reach — a customer recording their own transfer — was
       * also the unchecked one.
       */
      if (input.evidenceContentType && input.evidenceSizeBytes) {
        await verifyUpload({
          key,
          expectedSizeBytes: input.evidenceSizeBytes,
          expectedContentType: input.evidenceContentType,
        });
      }

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

    // `skipVerification`: there is no provider to ask. The staff member's
    // confirmation *is* the verification, which is exactly why this is a
    // separate permission and fully audited. The amount is still checked
    // against the order total inside — a typo does not fulfil.
    const result = await processPaymentSucceeded({
      provider: "manual",
      providerRef: payment.providerRef,
      source: `manual:${staff.user.id}`,
      actor: staffActor(staff.user),
      skipVerification: true,
    });

    if (result.outcome === "requires_review") {
      return fail(
        `That amount doesn't match the order total, so nothing was fulfilled. ${result.reason ?? ""}`.trim(),
        { code: "VALIDATION", fieldErrors: { amount: ["Doesn't match the order total."] } },
      );
    }

    await writeAuditLog({
      action: "payment.recorded_manually",
      actor: staffActor(staff.user),
      subject: { type: "order", id: String(order._id) },
      organizationId: String(order.organizationId),
      after: {
        reference: payment.reference,
        amount: amount.amount,
        currency: amount.currency,
        ...(input.bankReference ? { bankReference: input.bankReference } : {}),
        ...(input.note ? { note: input.note } : {}),
        // Recorded as a boolean, never as the key — an audit row is read by
        // more people than the evidence route lets through.
        evidenceAttached: Boolean(input.evidenceKey),
        outcome: result.outcome,
      },
      source: `manual:${staff.user.id}`,
    });

    revalidatePath("/admin/payments");
    revalidatePath("/admin/orders");

    return ok({ recorded: true as const, orderReference: input.orderReference });
  });
}

/**
 * A presigned PUT for a payment receipt.
 *
 * ## The key is minted against a payment that does not exist yet
 *
 * The upload happens *before* the payment record — the staff member picks the
 * file, then submits the form. So the client passes a `draftId` it generated,
 * the key is built under `payments/{draftId}/`, and
 * `recordManualPaymentAction` checks the key against the payment it just
 * created.
 *
 * That check only works if the two ids match, which is why the same `draftId`
 * is submitted with the form and used as the payment's `_id`. A client that
 * sends a mismatched pair gets a refusal rather than an attachment.
 */
export async function createEvidenceUploadAction(
  input: unknown,
): Promise<ActionResult<{ uploadUrl: string; key: string; headers: Record<string, string> }>> {
  return withAction(async () => {
    await requirePermission("payment.record_manual");

    const parsed = parseInput(
      z.object({
        draftId: objectIdSchema,
        filename: z.string().trim().min(1).max(255),
        contentType: z.string().trim().min(1).max(120),
        sizeBytes: z.coerce.number().int().positive(),
      }),
      input,
    );

    const storage = await import("@/services/storage");

    const ticket = await storage.createUploadUrl({
      scope: "payment-proof",
      // Built server-side from the draft id. A client-supplied key would be a
      // claim about where somebody's banking may be written.
      key: storage.paymentProofPath(parsed.draftId, parsed.filename),
      filename: parsed.filename,
      contentType: parsed.contentType,
      sizeBytes: parsed.sizeBytes,
    });

    // No `publicUrl` in the response, unlike the media equivalent. There is no
    // address for this object and there must not be one.
    return ok({ uploadUrl: ticket.url, key: ticket.key, headers: ticket.headers });
  });
}

/**
 * Bank details for customers paying by transfer.
 *
 * Not a secret, unlike the provider keys above — bank details are printed on
 * every invoice in the world, and a customer cannot pay without them. That is
 * exactly why they live in a settings row while the provider credentials live
 * in the environment as *names*: the distinction is "can this be shown to a
 * customer", not "is this configuration".
 *
 * Clearing the text turns the option off at checkout, because offering to take
 * a transfer without saying where to send it is worse than not offering.
 */
export async function saveOfflineInstructionsAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("payment_provider.configure");

    const input = parseInput(
      z.object({
        offlineEnabled: z
          .union([z.literal("on"), z.literal("")])
          .optional()
          .transform((value) => value === "on"),
        offlineInstructions: z.string().trim().max(2000),
      }),
      parseNestedFormData(formData),
    );

    await connectToDatabase();
    await PaymentSettings.findOneAndUpdate(
      { singleton: "global" },
      {
        $set: {
          singleton: "global",
          offlineEnabled: input.offlineEnabled,
          offlineInstructions: input.offlineInstructions,
          updatedByUserId: toObjectId(staff.user.id),
        },
      },
      { upsert: true, runValidators: true },
    );

    await writeAuditLog({
      action: "payment_settings.offline_changed",
      actor: staffActor(staff.user),
      // The instructions themselves are not in the audit payload: they are bank
      // details, and an audit row is read by more people than the settings
      // screen. Whether it is on, and that it changed, is the auditable fact.
      after: {
        enabled: input.offlineEnabled,
        instructionsPresent: input.offlineInstructions.length > 0,
      },
    });

    revalidatePath("/admin/settings/payments");
    revalidatePath("/checkout");
    return ok({ saved: true as const });
  });
}
