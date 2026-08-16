"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requireOrg, requireUser } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { Organization } from "@/lib/db/models/identity";
import { toObjectId } from "@/lib/db/base";
import { placeOrderSchema } from "@/validators/checkout";
import { staffActor } from "@/services/audit";
import * as checkout from "@/services/checkout/checkout-service";
import { initiatePaymentForOrder } from "@/services/payments/payment-service";
import { readOwnerKey } from "@/services/cart/owner";

/**
 * Checkout actions — §13.
 *
 * ## The action takes an address, not a total
 *
 * `placeOrderSchema` has no `total`, no `subtotal`, no line prices. The server
 * re-prices the cart from live products inside `createOrder`, which is the
 * "editing the total in the browser changes nothing" criterion made structural
 * rather than checked.
 */

export async function placeOrderAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  let reference: string | undefined;
  let redirectUrl: string | undefined;
  let offline = false;

  const result = await withAction<never>(async () => {
    const user = await requireUser();
    const { organizationId } = await requireOrg();

    const raw = parseNestedFormData(formData);
    const input = parseInput(placeOrderSchema, raw);

    const ownerKey = await readOwnerKey(user.id);
    if (!ownerKey) {
      return {
        ok: false as const,
        error: "Your basket is empty.",
        code: "VALIDATION" as const,
      };
    }

    // Kept on the organisation for next time, and snapshotted onto the order
    // separately — the two must be able to diverge, because an organisation
    // that moves must not rewrite last year's invoices.
    await rememberBillingDetails(organizationId, input);

    const { organizationName, idempotencyKey, paymentMethod, ...address } = input;
    const created = await checkout.createOrder(
      {
        ownerKey,
        userId: user.id,
        organizationId,
        billing: { organizationName, ...address },
        ...(idempotencyKey ? { idempotencyKey } : {}),
        paymentMethod,
      },
      staffActor({ id: user.id, name: user.name }),
    );

    reference = created.order.reference;

    /*
     * Paying by transfer: no provider, no redirect, and deliberately **no
     * payment record**. A `pending` payment here would be a lie — nobody has
     * attempted anything yet — and it would give the reconciliation sweep
     * something to chase that no provider can answer for.
     *
     * The order sits in `awaiting_payment` until a staff member records the
     * transfer, which runs the identical fulfilment path. Nothing is delivered
     * in the meantime.
     */
    if (paymentMethod === "offline") {
      offline = true;
      revalidatePath("/", "layout");
      return ok(undefined as never);
    }

    // Hand off to the provider. Everything before this point is ours; from
    // here the customer is on somebody else's page until the webhook lands.
    const initiated = await initiatePaymentForOrder({
      orderReference: created.order.reference,
      organizationId,
      customerEmail: input.email,
      ...(input.contactName ? { customerName: input.contactName } : {}),
      actor: staffActor({ id: user.id, name: user.name }),
    });

    redirectUrl = initiated.redirectUrl;
    revalidatePath("/", "layout");

    return ok(undefined as never);
  });

  if (!result.ok) return result;

  // To the provider, not to a success page. The customer comes back to
  // `/checkout/processing`, which polls — because the redirect proves nothing
  // and the webhook is the authority (§13, §103).
  // `typedRoutes` cannot type an external URL, and this one is deliberately
  // external — it is the provider's hosted payment page.
  if (redirectUrl) redirect(redirectUrl as Route);

  /*
   * Two ways to arrive here, and they want different pages.
   *
   * An **offline** order is finished: it is placed, and what the customer needs
   * next is where to send the money. The confirmation page carries that.
   *
   * An **online** order that got no redirect URL means no provider could take
   * this currency. The order exists and is payable later, so the processing
   * page is still right — it shows the order awaiting payment rather than a lie
   * about a payment that never started.
   */
  if (offline) redirect(`/orders/${reference}/confirmation` as Route);

  redirect(`/checkout/processing?order=${reference}` as Route);
}

/**
 * Save the address back to the organisation.
 *
 * Best-effort and separate from the order: failing to remember an address for
 * next time is not a reason to refuse a sale. The order carries its own copy.
 */
async function rememberBillingDetails(
  organizationId: string,
  input: { organizationName: string; email: string; taxId?: string } & Record<string, unknown>,
): Promise<void> {
  try {
    await connectToDatabase();
    await Organization.updateOne(
      { _id: toObjectId(organizationId) },
      {
        $set: {
          billingEmail: input.email,
          billingAddress: {
            line1: input.line1,
            line2: input.line2,
            city: input.city,
            region: input.region,
            postcode: input.postcode,
            country: input.country,
          },
          ...(input.taxId ? { taxId: input.taxId } : {}),
        },
      },
    );
  } catch (error) {
    console.warn("[checkout] could not save billing details for next time", {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
