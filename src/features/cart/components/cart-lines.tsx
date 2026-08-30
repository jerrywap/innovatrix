"use client";

import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Minus, Plus, Trash2, TriangleAlert } from "lucide-react";
import { FreeBadge } from "@/components/free-badge";
import { MoneyDisplay } from "@/components/money-display";
import { money } from "@/lib/money";
import { removeLineAction, setQuantityAction } from "../actions";
import type { CartLineView, CartNotice } from "@/services/cart/cart-service";
import { productHref } from "@/config/catalogue";

/**
 * The basket's line items — §12.
 *
 * Add-ons render **nested under the product they belong to**, which is not
 * decoration: it is what makes "removing the product removes its add-ons"
 * legible before it happens, rather than a surprise afterwards.
 *
 * Prices arrive already computed by the server. This component does no
 * arithmetic at all — not even a line total — because §84's integer minor units
 * stop being safe the moment a browser divides by a hundred.
 */
export function CartLines({
  lines,
  notices,
  currency,
}: {
  lines: readonly CartLineView[];
  notices: readonly CartNotice[];
  currency: string;
}) {
  const products = lines.filter((line) => line.kind === "product_licence");
  const addonsByParent = new Map<string, CartLineView[]>();
  for (const line of lines) {
    if (line.kind !== "addon" || !line.parentLineId) continue;
    addonsByParent.set(line.parentLineId, [
      ...(addonsByParent.get(line.parentLineId) ?? []),
      line,
    ]);
  }

  // An add-on whose parent has gone — shouldn't happen, but rendering it
  // orphaned is better than dropping a line the customer is being charged for.
  const orphans = lines.filter(
    (line) =>
      line.kind === "addon" &&
      (!line.parentLineId || !products.some((p) => p.lineId === line.parentLineId)),
  );

  return (
    <ul className="border-border divide-border divide-y rounded-xl border">
      {[...products, ...orphans].map((line) => (
        <li key={line.lineId} className="p-4">
          <ProductLine line={line} notices={notices} currency={currency} />

          {(addonsByParent.get(line.lineId) ?? []).length > 0 && (
            <ul className="border-border mt-3 ml-4 flex flex-col gap-2 border-l pl-4">
              {(addonsByParent.get(line.lineId) ?? []).map((addon) => (
                <li key={addon.lineId} className="flex items-center justify-between gap-3">
                  <span className="text-[13px]">{addon.displayName}</span>
                  <span className="flex items-center gap-3">
                    {/*
                      Two different zeroes, and this used to show "quoted" for
                      both. A `quote_required` add-on is priced later; a free one
                      is priced now, at nothing. `addonPricingType` is what tells
                      them apart — without it a free plugin read as "quoted",
                      which invites the customer to wait for a quote that is
                      never coming.
                    */}
                    {addon.addonPricingType === "quote_required" ? (
                      <span className="text-subtle text-[12px]">quoted</span>
                    ) : addon.unitPrice.amount === 0 ? (
                      <FreeBadge size="compact" />
                    ) : (
                      <MoneyDisplay value={addon.lineTotal} className="text-[13px]" />
                    )}
                    <RemoveButton lineId={addon.lineId} label={addon.displayName} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProductLine({
  line,
  notices,
  currency,
}: {
  line: CartLineView;
  notices: readonly CartNotice[];
  currency: string;
}) {
  const lineNotices = notices.filter((notice) => notice.lineId === line.lineId);

  return (
    <div className="flex gap-4">
      {line.imageUrl ? (
        <Image
          src={line.imageUrl}
          alt=""
          width={80}
          height={60}
          className="border-border bg-surface-muted h-[60px] w-20 shrink-0 rounded-lg border object-cover"
        />
      ) : (
        <div className="border-border bg-surface-muted h-[60px] w-20 shrink-0 rounded-lg border" />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={productHref(line.productSlug) as Route}
              className="text-[14px] font-medium hover:underline"
            >
              {line.productName}
            </Link>
            {line.displaySummary && (
              <p className="text-muted-foreground text-[12.5px]">{line.displaySummary}</p>
            )}
          </div>
          <MoneyDisplay value={line.lineTotal} className="text-[14px] font-medium" />
        </div>

        {lineNotices.map((notice, index) => (
          <p
            key={index}
            className="flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-400"
          >
            <TriangleAlert className="size-3 shrink-0" aria-hidden />
            {notice.message}
          </p>
        ))}

        <div className="flex items-center gap-3">
          {line.quantityLocked ? (
            <span className="text-subtle text-[12px]">
              Single installation ·{" "}
              <MoneyDisplay value={money(line.unitPrice.amount, currency as "GBP")} compact />
            </span>
          ) : (
            <QuantityStepper lineId={line.lineId} quantity={line.quantity} />
          )}

          <RemoveButton lineId={line.lineId} label={line.productName} />
        </div>
      </div>
    </div>
  );
}

function QuantityStepper({ lineId, quantity }: { lineId: string; quantity: number }) {
  const [pending, startTransition] = useTransition();

  const set = (next: number) => {
    startTransition(async () => {
      await setQuantityAction(lineId, next);
    });
  };

  return (
    <div className="border-border flex items-center rounded-lg border">
      <button
        type="button"
        onClick={() => set(quantity - 1)}
        disabled={pending || quantity <= 1}
        className="hover:bg-surface-muted px-2 py-1 disabled:opacity-40"
      >
        <Minus className="size-3" aria-hidden />
        <span className="sr-only">One fewer</span>
      </button>
      <span
        className="min-w-8 text-center font-mono text-[12.5px]"
        aria-live="polite"
        aria-label={`Quantity ${quantity}`}
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => set(quantity + 1)}
        disabled={pending || quantity >= 99}
        className="hover:bg-surface-muted px-2 py-1 disabled:opacity-40"
      >
        <Plus className="size-3" aria-hidden />
        <span className="sr-only">One more</span>
      </button>
    </div>
  );
}

function RemoveButton({ lineId, label }: { lineId: string; label: string }) {
  const [, formAction] = useActionState(removeLineAction, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="lineId" value={lineId} />
      <RemoveSubmit label={label} />
    </form>
  );
}

function RemoveSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-subtle p-1 hover:text-[var(--danger)] disabled:opacity-40"
    >
      <Trash2 className="size-3.5" aria-hidden />
      <span className="sr-only">Remove {label}</span>
    </button>
  );
}
