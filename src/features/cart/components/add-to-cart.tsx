"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShoppingCart } from "lucide-react";
import { addToCartAction } from "../actions";

/**
 * Buy As-Is — §5's first door, and the button ticket 09 left disabled.
 *
 * ## It navigates rather than opening a drawer
 *
 * §12 asks for "add-to-cart feedback"; a drawer is one way and a redirect to
 * the basket is another. This does the second, because the basket page already
 * carries every notice the drawer would have to duplicate — a price change, an
 * item no longer sold in this currency, a refused code — and a drawer that
 * shows a subset is a drawer that hides the one that mattered.
 *
 * The inline confirmation covers the case where the customer is adding a
 * second item and does not want to be moved.
 */
export function AddToCart({
  productId,
  licencePackageKey,
  addonKeys,
  disabled,
  label = "Buy as-is",
}: {
  productId: string;
  licencePackageKey?: string;
  addonKeys?: readonly string[];
  disabled?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={pending || disabled}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await addToCartAction({
              productId,
              ...(licencePackageKey ? { licencePackageKey } : {}),
              ...(addonKeys?.length ? { addonKeys: [...addonKeys] } : {}),
            });

            if (!result.ok) {
              // A currency conflict arrives here as a CONFLICT with an
              // actionable message — "switch your basket to a currency it's
              // priced in" — so it is shown verbatim rather than flattened.
              setError(result.error);
              return;
            }

            setAdded(true);
            router.push("/cart");
          });
        }}
        className="bg-foreground text-background flex items-center justify-center gap-2 rounded-full px-5 py-3 text-[14px] font-medium transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : added ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <ShoppingCart className="size-4" aria-hidden />
        )}
        {added ? "Added" : label}
      </button>

      {error && (
        <p role="alert" className="text-[12.5px] text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
