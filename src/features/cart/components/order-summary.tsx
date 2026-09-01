"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { Route } from "next";
import { Tag, X } from "lucide-react";
import { MoneyDisplay } from "@/components/money-display";
import { CURRENCIES } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { applyDiscountAction } from "../actions";
import type { CartTotals } from "@/services/cart/calculate";
import type { CartBlockedLine } from "@/services/cart/cart-service";

/**
 * Subtotal, discount, tax, total — §12.
 *
 * Every figure is rendered from the server's `CartTotals`. There is no
 * arithmetic here, and the discount and tax lines only appear when they are
 * non-zero: a permanent "Tax £0.00" row on a cart with no billing address reads
 * as a claim that no tax is due, which is not what it means.
 */
export function OrderSummary({
  totals,
  discountCode,
  checkoutHref = "/checkout",
  blocked = [],
  currency,
  showCheckout = true,
}: {
  totals: CartTotals;
  discountCode?: string;
  checkoutHref?: string;
  /**
   * The lines that cannot be bought — `CartView.blocked`, the same array the
   * rows above come from and the same one `assertOrderable` refuses on. The
   * lines rather than a boolean, so the reason here can be specific about which
   * of the two problems it is.
   */
  blocked?: readonly CartBlockedLine[];
  currency: string;
  /**
   * `false` on `/checkout`, which renders this panel for its figures and has its
   * own submit button.
   *
   * It used to pass `disabled` for that, which is a different thing: the panel
   * dutifully rendered "Resolve the items above to continue." on a page with
   * nothing wrong with it, permanently.
   */
  showCheckout?: boolean;
}) {
  const allCurrency = blocked.every((line) => line.reason === "no_price_in_currency");
  return (
    <div className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-5">
      <h2 className="font-display text-[16px] tracking-[-0.02em]">Summary</h2>

      <DiscountForm code={discountCode} />

      <dl className="flex flex-col gap-2 text-[13.5px]">
        <Row label="Subtotal" value={<MoneyDisplay value={totals.subtotal} />} />

        {totals.discount.amount > 0 && (
          <Row
            label={totals.discountCode ? `Discount (${totals.discountCode})` : "Discount"}
            value={
              <span className="text-emerald-700 dark:text-emerald-400">
                −<MoneyDisplay value={totals.discount} />
              </span>
            }
          />
        )}

        {totals.tax.amount > 0 && (
          <Row
            label={`Tax${totals.taxBasisPoints ? ` (${totals.taxBasisPoints / 100}%)` : ""}`}
            value={<MoneyDisplay value={totals.tax} />}
          />
        )}
      </dl>

      <div className="border-border flex items-baseline justify-between border-t pt-3">
        <span className="text-[14px] font-medium">Total</span>
        <MoneyDisplay
          value={totals.total}
          className="font-display text-[22px] tracking-[-0.02em]"
        />
      </div>

      {totals.tax.amount === 0 && (
        <p className="text-subtle text-[11.5px]">
          Any tax due is calculated at checkout, once we have your billing address.
        </p>
      )}

      {/*
        Blocked, Checkout stays where it is and goes grey.

        It used to be replaced by the sentence "Resolve the items above to
        continue." — in this column, about items in the other one, which had in
        any case been dropped from the page. `publish-panel.tsx` states the rule:
        hiding the control entirely leaves somebody hunting for where it went.
        The objection to a disabled button — that it explains nothing — is
        answered by `aria-describedby` and by the rows carrying the fix.
      */}
      {!showCheckout ? null : blocked.length > 0 ? (
        <>
          <button
            type="button"
            disabled
            aria-describedby="checkout-blocked"
            className="bg-foreground text-background rounded-full px-5 py-3 text-center text-[14px] font-medium opacity-40"
          >
            Checkout
          </button>
          <p id="checkout-blocked" className="text-subtle text-center text-[12.5px]">
            {blocked.length === 1 ? "1 item" : `${blocked.length} items`}{" "}
            {allCurrency ? `not sold in ${symbolOf(currency)}.` : "you can't buy right now."}
          </p>
        </>
      ) : (
        <Link
          href={checkoutHref as Route}
          className="bg-foreground text-background rounded-full px-5 py-3 text-center text-[14px] font-medium transition hover:opacity-90"
        >
          Checkout
        </Link>
      )}
    </div>
  );
}

/**
 * The symbol, not the code. "isn't sold in ₦" reads as a sentence where "isn't
 * sold in NGN" reads as a field value — and ₦ is what every price beside it uses.
 */
function symbolOf(code: string): string {
  return CURRENCIES[code as keyof typeof CURRENCIES]?.symbol ?? code;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function DiscountForm({ code }: { code?: string }) {
  const [state, formAction] = useActionState(applyDiscountAction, null);
  const rejected = state?.ok && !state.data.applied && state.data.message;

  if (code) {
    return (
      <form action={formAction} className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13px]">
          <Tag className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <span className="font-mono">{code}</span>
        </span>
        <input type="hidden" name="code" value="" />
        <button type="submit" className="text-subtle hover:text-foreground p-1">
          <X className="size-3.5" aria-hidden />
          <span className="sr-only">Remove the discount code {code}</span>
        </button>
      </form>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          name="code"
          placeholder="Discount code"
          maxLength={40}
          aria-label="Discount code"
          className="h-9 font-mono text-[12.5px] uppercase"
        />
        <ApplyButton />
      </div>
      {rejected && (
        <p role="alert" className="text-[12px] text-amber-700 dark:text-amber-400">
          {state.data.message}
        </p>
      )}
    </form>
  );
}

function ApplyButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border hover:bg-surface-muted h-9 shrink-0 rounded-lg border px-3 text-[12.5px] disabled:opacity-50"
    >
      {pending ? "…" : "Apply"}
    </button>
  );
}
