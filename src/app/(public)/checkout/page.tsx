import type { Metadata } from "next";
import { Suspense } from "react";
import { randomBytes } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getSession, loginDestination, requireOrg } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { Organization } from "@/lib/db/models/identity";
import { toObjectId } from "@/lib/db/base";
import { loadCart } from "@/features/cart/load";
import { CartLines } from "@/features/cart/components/cart-lines";
import { OrderSummary } from "@/features/cart/components/order-summary";
import { BillingForm } from "@/features/checkout/components/billing-form";
import { offlinePaymentAvailability } from "@/services/payments/offline";
import { providersFor } from "@/services/payments/registry";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

/**
 * Checkout — §13.
 *
 * ## Signing in is a redirect, not a step
 *
 * §13's flow has an account step. For a signed-out visitor this route sends
 * them to `/login?next=/checkout`, which is the same thing with one fewer page
 * to design and a working Back button. Guests creating an account inline is a
 * genuine §13 requirement and is **not** built here — noted in the ticket
 * rather than half-done.
 */
export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader title="Checkout" />
      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
          <CheckoutBody />
        </Suspense>
      </div>
    </div>
  );
}

async function CheckoutBody() {
  const session = await getSession();
  // Same stale-cookie hazard as the dashboard: `/login` with a cookie the
  // server rejects bounces back. `loginDestination()` clears it first, and now
  // carries `?next=` on both of its branches — this used to append `/checkout`
  // by hand and give up in the stale case, which is what made the gap in
  // `loginDestination` visible in the first place.
  if (!session) redirect(await loginDestination());

  const cart = await loadCart();
  if (!cart || cart.lines.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Your basket is empty"
        description="There's nothing to check out yet."
        action={
          <Link
            href="/marketplace"
            className="border-border hover:bg-surface-muted rounded-full border px-4 py-2 text-[13px]"
          >
            Browse the marketplace
          </Link>
        }
      />
    );
  }

  const { organizationId, organization } = await requireOrg();
  await connectToDatabase();
  const org = await Organization.findById(toObjectId(organizationId))
    .select({ name: 1, billingEmail: 1, billingAddress: 1, taxId: 1 })
    .lean<{
      name: string;
      billingEmail?: string;
      taxId?: string;
      billingAddress?: Record<string, string | undefined>;
    }>();

  // Minted per render of this page, which is once per visit to checkout. Two
  // submits of the *same* rendered form share it; a genuine second visit gets
  // a new one — and the server's content-derived fallback covers the rest.
  const idempotencyKey = randomBytes(16).toString("hex");

  // Read from settings rather than hard-coded: a platform that has not written
  // its bank details anywhere must not offer to take a transfer, because the
  // customer would have nowhere to send it.
  const offline = await offlinePaymentAvailability();

  // Whether a card payment is even possible in this cart's currency, asked
  // before the customer fills anything in. `providersFor` applies the same
  // three gates the resolver will — including which currencies the merchant's
  // own account is provisioned for — so the form cannot offer a method that
  // checkout would then refuse.
  const cardAvailable = (await providersFor(cart.currency)).length > 0;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <BillingForm
        idempotencyKey={idempotencyKey}
        offlineAvailable={offline.available}
        cardAvailable={cardAvailable}
        free={cart.totals.total.amount === 0}
        currency={cart.currency}
        defaults={{
          organizationName: org?.name ?? organization.name,
          ...(session.user.name ? { contactName: session.user.name } : {}),
          email: org?.billingEmail ?? session.user.email,
          ...(org?.billingAddress?.line1 ? { line1: org.billingAddress.line1 } : {}),
          ...(org?.billingAddress?.line2 ? { line2: org.billingAddress.line2 } : {}),
          ...(org?.billingAddress?.city ? { city: org.billingAddress.city } : {}),
          ...(org?.billingAddress?.region ? { region: org.billingAddress.region } : {}),
          ...(org?.billingAddress?.postcode ? { postcode: org.billingAddress.postcode } : {}),
          ...(org?.billingAddress?.country ? { country: org.billingAddress.country } : {}),
          ...(org?.taxId ? { taxId: org.taxId } : {}),
        }}
      />

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="border-border rounded-xl border p-4">
          <h2 className="text-subtle mb-3 font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Your order
          </h2>
          <CartLines lines={cart.lines} notices={cart.notices} currency={cart.currency} />
        </div>

        <OrderSummary
          totals={cart.totals}
          {...(cart.discountCode ? { discountCode: cart.discountCode } : {})}
          currency={cart.currency}
          showCheckout={false}
        />
      </aside>
    </div>
  );
}
