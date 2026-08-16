import "server-only";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { loadCart } from "../load";

/**
 * The basket link in the public header.
 *
 * A Server Component behind the header's Suspense boundary — it reads the cart
 * cookie, so it is dynamic, and putting it in the static shell would undo the
 * PPR work ticket 08 did on `(public)/layout.tsx`.
 *
 * Renders nothing when the basket is empty. An empty-basket icon on every page
 * is a permanent invitation to look at nothing.
 */
export async function CartBadge() {
  const cart = await loadCart();
  if (!cart || cart.itemCount === 0) return null;

  return (
    <Link
      href="/cart"
      className="hover:bg-surface-muted relative flex items-center gap-1.5 rounded-full px-3 py-2 text-[13.5px] font-medium transition"
    >
      <ShoppingCart className="size-4" aria-hidden />
      <span className="sr-only">Basket, </span>
      <span className="font-mono text-[12px]">{cart.itemCount}</span>
      <span className="sr-only">{cart.itemCount === 1 ? "item" : "items"}</span>
    </Link>
  );
}
