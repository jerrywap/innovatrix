import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { CURRENCY_COOKIE, toStorefrontCurrency } from "@/config/storefront";
import { getSession } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { Organization } from "@/lib/db/models/identity";
import { carts } from "@/repositories/cart.repository";
import { recalculate, type CartView } from "@/services/cart/cart-service";
import { readOwnerKey } from "@/services/cart/owner";

/**
 * The cart, priced, for a Server Component.
 *
 * React `cache`-wrapped: the header badge and the cart page both need it on the
 * same render, and without memoisation that is two full re-pricings — each one
 * a product query and a discount lookup.
 *
 * Returns `null` rather than an empty cart when there is no cart at all, so the
 * header can render nothing instead of a zero badge.
 */
export const loadCart = cache(async (): Promise<CartView | null> => {
  const session = await getSession();
  const ownerKey = await readOwnerKey(session?.user.id);
  if (!ownerKey) return null;

  await connectToDatabase();
  const cart = await carts.findByOwnerKey(ownerKey);
  if (!cart) return null;

  const organizationId = session?.activeOrganizationId ?? undefined;
  const country = organizationId ? await billingCountry(organizationId) : undefined;

  return recalculate(cart, {
    ...(country ? { organizationCountry: country } : {}),
    ...(organizationId ? { organizationId } : {}),
  });
});

/** The active storefront currency, for a cart that does not exist yet. */
export const cartCurrency = cache(async () => {
  const jar = await cookies();
  return toStorefrontCurrency(jar.get(CURRENCY_COOKIE)?.value);
});

/**
 * Where the organisation is billed, which is what tax keys on.
 *
 * `undefined` before checkout collects an address — so the cart shows
 * tax-free totals and checkout adds the line once it knows. Showing a guessed
 * rate and then changing it at payment is worse than showing none.
 */
const billingCountry = cache(async (organizationId: string): Promise<string | undefined> => {
  await connectToDatabase();
  const org = await Organization.findById(organizationId)
    .select({ billingAddress: 1 })
    .lean<{ billingAddress?: { country?: string } }>();
  return org?.billingAddress?.country;
});
