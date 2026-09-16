"use server";

import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { requireOrg } from "@/lib/auth/dal";
import { objectIdSchema, optionalText } from "@/validators/common";
import { staffActor } from "@/services/audit";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { payableCurrencies } from "@/services/payments/registry";
import { createTip } from "@/services/tips/tip-service";
import { initiatePaymentForTip } from "@/services/payments/payment-service";
import { Entitlement } from "@/lib/db/models/commerce";
import { toObjectId } from "@/lib/db/base";

/**
 * Tipping a vendor — §the goodwill one.
 *
 * ## Guarded like a purchase, because money moves
 *
 * `requireOrg()` for the same reason `claimFreeProductAction` takes it: the
 * payment is taken from an organisation's account and the audit row is scoped to
 * one. A signed-out visitor cannot tip, and the modal does not offer it.
 *
 * ## The amount is validated server-side against the currency
 *
 * The presets are rendered by the client, so they are a suggestion and nothing
 * more — `createTip` re-checks the floor and the ceiling for the currency the
 * *server* resolved, not the one the form claimed. A currency in the payload
 * would let a caller pick whichever one the limits are loosest in.
 */

const tipSchema = z.object({
  productId: objectIdSchema,
  amount: z.coerce.number().int(),
  /**
   * Which currency to charge in — allow-listed, never free text.
   *
   * It has to be accepted from the form because the dialog offers a switch: a
   * viewer browsing in a currency no provider serves would otherwise have no way
   * to tip at all. `z.enum` bounds it to the storefront's own list, and
   * `payableCurrencies()` below re-checks that we can actually charge it, so the
   * client chooses *from what the server offered* rather than naming its own.
   */
  currency: z.enum(STOREFRONT_CURRENCIES).optional(),
  note: optionalText(280),
});

export async function createTipAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ redirectUrl: string }>> {
  return withAction(async () => {
    const { user, organizationId } = await requireOrg();
    const input = parseInput(tipSchema, {
      productId: formData.get("productId"),
      amount: formData.get("amount"),
      currency: formData.get("currency") || undefined,
      note: formData.get("note"),
    });

    /*
     * The form's choice when it made one, the cookie otherwise — and then a
     * check that we can take it either way.
     *
     * The refusal used to come from `resolveProvider`, three calls deeper and
     * after a `Tip` row had already been written: the customer met
     * "We can't take payment in GBP at the moment" having already chosen an
     * amount, and an unpayable tip was left behind in the database.
     */
    const currency = input.currency ?? (await resolveStorefrontCurrency());
    const payable = await payableCurrencies();

    if (!payable.includes(currency)) {
      return fail(
        payable.length > 0
          ? `We can't take ${currency} at the moment. Try ${payable.join(" or ")}.`
          : "Tips aren't available at the moment — we can't take payment in any currency.",
      );
    }

    const { tip } = await createTip(
      {
        productId: input.productId,
        amount: input.amount,
        currency,
        ...(input.note ? { note: input.note } : {}),
      },
      { userId: user.id, organizationId },
    );

    const initiated = await initiatePaymentForTip({
      tipId: String(tip._id),
      organizationId,
      customerEmail: user.email,
      ...(user.name ? { customerName: user.name } : {}),
      actor: staffActor({ id: user.id, name: user.name }),
    });

    return ok({ redirectUrl: initiated.redirectUrl });
  });
}

const dismissSchema = z.object({ entitlementId: objectIdSchema });

/**
 * "Not this time" — and we do not ask again for this purchase.
 *
 * Permanent by design, and the reasoning is `reviewPromptDismissedAt`'s, which
 * this copies: *"ask me later" is a mechanism for asking four times, and the
 * fourth is the one they remember.* Tipping stays available from the product
 * page; it is the unprompted ask that stops.
 */
export async function dismissTipPromptAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ dismissed: true }>> {
  return withAction(async () => {
    const { organizationId } = await requireOrg();
    const input = parseInput(dismissSchema, { entitlementId: formData.get("entitlementId") });

    await Entitlement.updateOne(
      {
        _id: toObjectId(input.entitlementId),
        organizationId: toObjectId(organizationId),
      },
      { $set: { tipPromptDismissedAt: new Date() } },
    );

    return ok({ dismissed: true as const });
  });
}
