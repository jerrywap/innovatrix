"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { switchCartCurrencyAction } from "../actions";

/**
 * Switch the basket's currency — §12's "offering to switch the cart currency
 * (which re-prices every line and warns)".
 *
 * The warning is the point. Re-pricing is not conversion: each currency has its
 * own hand-set price (§43), so switching can change the total by a lot and in
 * either direction. Saying how many lines moved is more honest than a silent
 * re-render.
 */
export function CurrencySwitcher({ current }: { current: string }) {
  const [state, formAction] = useActionState(switchCartCurrencyAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
          Currency
        </span>
        {STOREFRONT_CURRENCIES.map((code) => (
          <SwitchButton key={code} code={code} active={code === current} />
        ))}
      </div>

      {state?.ok && state.data.repriced > 0 && (
        <p role="status" className="text-[12px] text-amber-700 dark:text-amber-400">
          {state.data.repriced} {state.data.repriced === 1 ? "item" : "items"} changed price —
          each currency is priced separately, not converted.
        </p>
      )}
      {state?.ok && state.data.unpriceable.length > 0 && (
        <p role="alert" className="text-[12px] text-[var(--danger)]">
          Not sold in {current}: {state.data.unpriceable.join(", ")}. Remove them or switch
          back.
        </p>
      )}
      {state && !state.ok && (
        <p role="alert" className="text-[12px] text-[var(--danger)]">
          {state.error}
        </p>
      )}
    </form>
  );
}

function SwitchButton({ code, active }: { code: string; active: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="currency"
      value={code}
      disabled={pending || active}
      aria-current={active ? "true" : undefined}
      className={`border-border rounded-lg border px-2.5 py-1 font-mono text-[11.5px] disabled:opacity-100 ${
        active
          ? "border-[var(--signal)] text-[var(--signal)]"
          : "text-subtle hover:bg-surface-muted"
      }`}
    >
      {code}
    </button>
  );
}
