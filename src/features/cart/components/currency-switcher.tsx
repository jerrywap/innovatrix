"use client";

import { useState, useTransition } from "react";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { switchCurrencyAction } from "../actions";

/**
 * Switch the basket's currency — §12's "offering to switch the cart currency
 * (which re-prices every line)".
 *
 * ## The same action as the header's switcher
 *
 * `switchCurrencyAction` writes the cookie *and* re-prices the cart, so these
 * three buttons and the menu in the header cannot drift apart. They did: the
 * header wrote only the cookie, so switching there left the basket priced in the
 * currency it was already in.
 *
 * ## No messages
 *
 * There were two, both transient `useActionState` copy, and both are gone.
 *
 * "N items changed price" counted lines whose minor-unit amount differed between
 * the two currencies — and £299.99 against ₦6,205,122 always differs, so it fired
 * on every switch and told nobody anything. An alarm that always rings is not a
 * warning.
 *
 * "Not sold in NGN: <product>. Remove them or switch back." named a product with
 * no row and no button behind it, and vanished on the next render — exactly when
 * somebody would look for it again. That state is server-rendered now, as rows,
 * by `blocked-lines.tsx`.
 *
 * ## Buttons, not a form
 *
 * The action takes an object rather than `FormData`, and `QuantityStepper` in
 * `cart-lines.tsx` is the existing shape for a control that just calls one. It
 * also keeps this clear of the `<form action={fn}>` reset trap AGENTS.md
 * describes, should a Radix control ever land beside it.
 */
export function CurrencySwitcher({ current }: { current: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const switchTo = (code: string) => {
    setError(null);
    startTransition(async () => {
      const result = await switchCurrencyAction({ currency: code });
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
          Currency
        </span>
        {STOREFRONT_CURRENCIES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => switchTo(code)}
            disabled={pending || code === current}
            aria-current={code === current ? "true" : undefined}
            className={`border-border rounded-lg border px-2.5 py-1 font-mono text-[11.5px] disabled:opacity-100 ${
              code === current
                ? "border-[var(--signal)] text-[var(--signal)]"
                : "text-subtle hover:bg-surface-muted"
            }`}
          >
            {code}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-danger text-[12px]">
          {error}
        </p>
      )}
    </div>
  );
}
