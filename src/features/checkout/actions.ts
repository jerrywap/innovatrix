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
import { initiatePaymentForOrder, settleFreeOrder } from "@/services/payments/payment-service";
import { readOwnerKey } from "@/services/cart/owner";
import { claimFreeProduct } from "@/services/checkout/free-claim";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { z } from "zod";
import { objectIdSchema } from "@/validators/common";

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
  let free = false;

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

    /*
     * A £0 basket — a free script whose plugins are all free too.
     *
     * Settled here rather than at a provider, because there is nothing to
     * charge. This branch is also what closes a real hole: before it,
     * `initiatePaymentForOrder` refused a zero total *after* `createOrder` had
     * committed, so the customer got a generic failure and was left with an
     * `awaiting_payment` order that nothing swept.
     *
     * If `settleFreeOrder` itself throws, the order stays `awaiting_payment`
     * with a `pending` free payment the sweep deliberately skips. Recovery is
     * the customer submitting again — the idempotency key finds the same order
     * and the pending payment is reused — or staff recording a £0 manual
     * payment, which already works. Strictly better than the orphan.
     */
    if (created.order.total.amount === 0) {
      await settleFreeOrder({
        orderReference: created.order.reference,
        organizationId,
        actor: staffActor({ id: user.id, name: user.name }),
      });
      free = true;
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
  // A free order is already paid and fulfilled, so there is nothing to poll —
  // the processing page would show a payment that never existed.
  if (offline || free) redirect(`/orders/${reference}/confirmation` as Route);

  redirect(`/checkout/processing?order=${reference}` as Route);
}

const claimFreeSchema = z.object({
  productId: objectIdSchema,
  licencePackageKey: z.string().trim().min(1).optional(),
});

/**
 * Take a free listing in one click — COS-12.
 *
 * ## Guarded like a purchase, because it is one
 *
 * It creates an order and grants an entitlement, so it takes the same
 * `requireUser()` + `requireOrg()` that `placeOrderAction` does. A free thing is
 * still somebody's property afterwards, and the download route needs both a
 * session and an active organisation to authorise against.
 *
 * That does mean a signed-out visitor cannot take one, unlike adding to the basket
 * — which works for guests on a cookie owner key. The button says so rather than
 * letting them find out by clicking.
 *
 * ## An href back, not a `redirect()`
 *
 * The destination is `/api/downloads/<id>`, a Route Handler that answers `307` to
 * a short-lived presigned S3 URL. `redirect()` here would hand that to the RSC
 * router, which is not what turns a `307` into a saved file; the client does a
 * plain document navigation instead. No bytes pass through the server either way —
 * the download route is untouched and still authorises, logs, then redirects.
 */
export async function claimFreeProductAction(
  input: unknown,
): Promise<ActionResult<{ href: string; alreadyOwned: boolean }>> {
  return withAction<{ href: string; alreadyOwned: boolean }>(async () => {
    const user = await requireUser();
    const { organizationId } = await requireOrg();

    const parsed = parseInput(claimFreeSchema, input);

    const claim = await claimFreeProduct(
      parsed,
      {
        userId: user.id,
        ...(user.name ? { userName: user.name } : {}),
        organizationId,
        // From the cookie, like every other price the visitor has been shown.
        // Passing a currency from the form would let the caller pick whichever
        // one this product happens to be free in.
        currency: await resolveStorefrontCurrency(),
      },
      staffActor({ id: user.id, name: user.name }),
    );

    revalidatePath("/", "layout");

    return ok({
      href: claim.fileId
        ? `/api/downloads/${claim.fileId}`
        : `/dashboard/software/${claim.entitlementId}`,
      alreadyOwned: claim.alreadyOwned,
    });
  });
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
