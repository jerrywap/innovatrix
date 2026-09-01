import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ShoppingCart, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCart } from "@/features/cart/load";
import { CartLines } from "@/features/cart/components/cart-lines";
import { OrderSummary } from "@/features/cart/components/order-summary";
import { CurrencySwitcher } from "@/features/cart/components/currency-switcher";
import { BlockedLines } from "@/features/cart/components/blocked-lines";

export const metadata: Metadata = {
  title: "Basket",
  description: "Your basket.",
  // A basket is per-visitor and has nothing to rank for.
  robots: { index: false, follow: true },
};

/**
 * The basket — §12.
 *
 * `loadCart()` reads cookies and the session, so it is dynamic and lives behind
 * a Suspense boundary; the heading and the shell prerender as usual.
 */
export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-10 lg:px-10 lg:py-14">
      <PageHeader title="Your basket" />
      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
          <CartContents />
        </Suspense>
      </div>
    </div>
  );
}

async function CartContents() {
  const cart = await loadCart();

  if (!cart || (cart.lines.length === 0 && cart.blocked.length === 0)) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Your basket is empty"
        description="Find something in the marketplace and it will show up here."
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

  // Notices without a line id are cart-level: a refused discount. Line-level
  // ones render against their line instead, and the blocking ones render as
  // rows of their own — `cart.blocked` is the same set, with the picture and the
  // controls attached.
  const cartNotices = cart.notices.filter((notice) => !notice.lineId);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        {cartNotices.map((notice, index) => (
          <p
            key={index}
            className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3.5 py-2.5 text-[12.5px]"
          >
            <TriangleAlert
              className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            {notice.message}
          </p>
        ))}

        <BlockedLines
          lines={cart.blocked}
          currency={cart.currency}
          priceableCurrencies={cart.priceableCurrencies}
        />

        {cart.lines.length > 0 && (
          <CartLines lines={cart.lines} notices={cart.notices} currency={cart.currency} />
        )}
        <CurrencySwitcher current={cart.currency} />
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <OrderSummary
          totals={cart.totals}
          {...(cart.discountCode ? { discountCode: cart.discountCode } : {})}
          blocked={cart.blocked}
          currency={cart.currency}
        />
      </aside>
    </div>
  );
}
