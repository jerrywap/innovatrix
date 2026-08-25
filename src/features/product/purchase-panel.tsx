"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { MonitorPlay, Sparkles } from "lucide-react";
import { FreeBadge } from "@/components/free-badge";
import { MoneyDisplay } from "@/components/money-display";
import { AddToCart } from "@/features/cart/components/add-to-cart";
import { GetItFree } from "@/features/checkout/components/get-it-free";
import { money } from "@/lib/money";
import type { StorefrontCurrency } from "@/config/storefront";

/** What the CTA needs. Deliberately not a credential in sight. */
export interface DemoCta {
  publicUrl?: string;
  hasCredentials: boolean;
  roleCount: number;
}
import type {
  DetailAddon,
  DetailLicencePackage,
  DetailPrice,
} from "@/services/marketplace/detail";

/**
 * Licence, add-ons and the two doors — §5, §8.
 *
 * ## The one criterion that forces a client component
 *
 * > Price and licence selection update the CTA without a full page reload.
 *
 * Everything else on this page is a Server Component. This is not, because the
 * selection has to change the total as you click.
 *
 * ## It is handed a price *table* and never does arithmetic
 *
 * Every licence package and add-on arrives with a price per storefront
 * currency, computed server-side. The client picks a row out of that table; it
 * never converts, never multiplies by a rate, and never sees a float. §84's
 * integer minor units are only safe as long as nothing in the browser is
 * tempted to divide by 100 and add things up — a total assembled here from
 * `29999 / 100` and `4999 / 100` is a rounding bug in a number somebody pays.
 *
 * Summing *within* one currency is integer addition, which is exact, so the
 * running total below is safe. Anything that would need a rate is absent by
 * design.
 *
 * ## Request Customization is hidden **and** refused
 *
 * `available` hides the button here. The action behind it re-checks the same
 * flag, because a hidden button is a drawing decision and the endpoint is
 * public either way. Ticket 17 owns the action; this owns the drawing.
 */
export function PurchasePanel({
  productId,
  slug,
  currency,
  licencePackages,
  addons,
  customisable,
  typicalTurnaround,
  demo,
  signedIn,
  owned,
  saveButton,
}: {
  productId: string;
  slug: string;
  currency: StorefrontCurrency;
  licencePackages: readonly DetailLicencePackage[];
  addons: readonly DetailAddon[];
  customisable: boolean;
  typicalTurnaround?: string;
  /** Whether there is a session — a free claim needs one, adding to the basket does not. */
  signedIn: boolean;
  /** Whether this organisation already has an active entitlement for the product. */
  owned: boolean;
  /**
   * Enough to decide whether there is anything to try, and where to send
   * somebody who wants to. **Never a credential** — the panel further down the
   * page is the only thing that reveals one, and only server-side after
   * `revealCredentials` has said the viewer qualifies.
   */
  demo: DemoCta;
  /** Rendered as a slot so this island does not also own the save state. */
  saveButton: React.ReactNode;
}) {
  const [selectedKey, setSelectedKey] = useState(licencePackages[0]?.key ?? "");
  const [chosenAddons, setChosenAddons] = useState<Set<string>>(new Set());

  const selected = licencePackages.find((pkg) => pkg.key === selectedKey);
  const priceIn = (prices: readonly DetailPrice[]) =>
    prices.find((price) => price.currency === currency);

  /*
   * The licence's price, and nothing else.
   *
   * This used to fall back to `basePrices` — the product-level price — when no
   * package was selected. That fallback is what made a package-less product *look*
   * purchasable: the Total showed the advertised number, the button stayed enabled,
   * and `addItem` then threw "That product has no licence to buy yet."
   *
   * A product cannot reach here without a package now (`createDraft` seeds one and
   * the pricing schema refuses an empty list), and `product.prices` is derived from
   * the packages anyway — so a fallback to it would only ever restate the same
   * number less reliably.
   */
  const licencePrice = selected ? priceIn(selected.prices) : undefined;

  const total = useMemo(() => {
    if (!licencePrice) return undefined;

    // Integer addition within a single currency — exact, and the only
    // arithmetic this component is allowed to do.
    let amount = licencePrice.amount;
    for (const addon of addons) {
      if (!chosenAddons.has(addon.key)) continue;
      const price = priceIn(addon.prices);
      // A `quote_required` add-on has no price to add. It is still selectable,
      // because "I want this quoted" is real information for the order.
      if (price) amount += price.amount;
    }
    return amount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licencePrice, chosenAddons, addons, currency]);

  const quoteOnly = addons.some(
    (addon) => chosenAddons.has(addon.key) && addon.pricingType === "quote_required",
  );

  return (
    <div className="border-border bg-surface flex flex-col gap-5 rounded-xl border p-5">
      {licencePackages.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-subtle mb-2 font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Licence
          </legend>

          {licencePackages.map((pkg) => {
            const price = priceIn(pkg.prices);
            return (
              <label
                key={pkg.key}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                  pkg.key === selectedKey
                    ? "border-[var(--signal)] bg-[var(--signal)]/6"
                    : "border-border hover:bg-surface-muted"
                }`}
              >
                <input
                  type="radio"
                  name="licence"
                  value={pkg.key}
                  checked={pkg.key === selectedKey}
                  onChange={() => setSelectedKey(pkg.key)}
                  className="mt-1 accent-[var(--signal)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[13.5px] font-medium">{pkg.name}</span>
                    {price ? (
                      price.amount === 0 ? (
                        <FreeBadge size="compact" />
                      ) : (
                        <MoneyDisplay
                          value={money(price.amount, currency)}
                          className="text-[13.5px]"
                        />
                      )
                    ) : (
                      <span className="text-subtle text-[12px]">On request</span>
                    )}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[12px]">
                    {licenceSummary(pkg)}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {addons.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-subtle mb-1.5 font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Add-ons
          </legend>

          {addons.map((addon) => {
            const price = priceIn(addon.prices);
            return (
              <label
                key={addon.key}
                className="hover:bg-surface-muted flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]"
              >
                <input
                  type="checkbox"
                  checked={chosenAddons.has(addon.key)}
                  onChange={(event) =>
                    setChosenAddons((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(addon.key);
                      else next.delete(addon.key);
                      return next;
                    })
                  }
                  className="accent-[var(--signal)]"
                />
                <span className="flex-1">{addon.name}</span>
                <span className="text-subtle font-mono text-[11.5px]">
                  {addon.pricingType === "quote_required" ? (
                    "quoted"
                  ) : price ? (
                    // A free plugin reads "Free", never "+£0.00" — the whole
                    // point of a free tier is that it does not look like a
                    // charge of nothing.
                    price.amount === 0 ? (
                      <FreeBadge size="compact" />
                    ) : (
                      <>
                        {addon.pricingType === "starting_from" ? "from " : "+"}
                        <MoneyDisplay value={money(price.amount, currency)} compact />
                      </>
                    )
                  ) : (
                    "—"
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="border-border flex items-baseline justify-between border-t pt-4">
        <span className="text-[13px] font-medium">Total</span>
        {total !== undefined ? (
          <span className="flex items-baseline gap-1.5">
            {total === 0 ? (
              <FreeBadge />
            ) : (
              <MoneyDisplay
                value={money(total, currency)}
                className="font-display text-[22px] tracking-[-0.02em]"
              />
            )}
            {quoteOnly && <span className="text-subtle text-[11.5px]">+ quoted items</span>}
          </span>
        ) : (
          <span className="text-muted-foreground text-[14px]">Price on request</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {/*
          Nothing to pay, so nothing to check out — COS-12.

          Gated on the **selection's** total rather than on the product, because a
          product can carry a free licence beside a paid one, and ticking a paid
          add-on turns a free basket into a payable one. `total === 0` is already
          what the Total row above uses to render "Free", so the button and the
          price can never disagree.

          And on *no add-ons at all*, not merely on a zero total. A
          `quote_required` add-on adds nothing to the total — it is priced later —
          so it would slip through a total-only check, and the free claim carries
          no add-ons. "I want this quoted" is real information for the order, and
          dropping it silently while the row is still ticked is worse than sending
          them through the basket, which is what that row is for.
        */}
        {total === 0 && chosenAddons.size === 0 ? (
          <GetItFree
            productId={productId}
            {...(selectedKey ? { licencePackageKey: selectedKey } : {})}
            signedIn={signedIn}
            owned={owned}
            productPath={`/marketplace/${slug}`}
            disabled={!selected}
          />
        ) : (
          /* Live as of ticket 10. The selection above decides what goes in —
             the licence, and whichever add-ons are ticked. */
          <AddToCart
            productId={productId}
            {...(selectedKey ? { licencePackageKey: selectedKey } : {})}
            addonKeys={[...chosenAddons]}
            disabled={!selected}
          />
        )}

        {customisable && (
          <Link
            href={`/customize/${slug}` as Route}
            className="border-border hover:bg-surface-muted flex items-center justify-center gap-2 rounded-full border px-5 py-3 text-[14px] font-medium transition"
          >
            <Sparkles className="size-4" aria-hidden />
            Request customization
          </Link>
        )}

        <TryDemo demo={demo} />

        {saveButton}
      </div>

      {customisable && typicalTurnaround && (
        <p className="text-subtle text-center text-[12px]">
          Customisations typically take {typicalTurnaround}.
        </p>
      )}

      <input type="hidden" value={productId} readOnly aria-hidden />
    </div>
  );
}

/**
 * §8's third CTA — "opens the demo panel / external demo".
 *
 * ## Two destinations, because there are two situations
 *
 * - **A public demo exists** → straight there, in a new tab. Nobody wants a
 *   scroll when the thing they asked for is a URL away.
 * - **Only credentials exist** → down to the demo section, which either shows
 *   them or explains what unlocks them. Sending somebody to a locked panel is
 *   still better than a dead button, because the panel says *why*.
 *
 * ## It renders nothing when there is no demo
 *
 * A greyed-out "Try Demo" is a promise the product cannot keep, and four CTAs
 * where one never works reads as a broken page rather than an honest one.
 *
 * ## What it is not allowed to know
 *
 * `hasCredentials` is a boolean and `roleCount` is a number. This is a **client
 * component**, so anything it receives is in the RSC payload — which is exactly
 * the leak `DemoPanel`'s two-function split exists to prevent. The rule holds
 * here too.
 */
function TryDemo({ demo }: { demo: DemoCta }) {
  if (!demo.publicUrl && !demo.hasCredentials) return null;

  const label = demo.publicUrl ? "Try the demo" : "See demo access";

  const className =
    "border-border hover:bg-surface-muted flex items-center justify-center gap-2 " +
    "rounded-full border px-5 py-3 text-[14px] font-medium transition";

  if (demo.publicUrl) {
    return (
      <a href={demo.publicUrl} target="_blank" rel="noopener noreferrer" className={className}>
        <MonitorPlay className="size-4" aria-hidden />
        {label}
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }

  // A plain anchor, not a router link: `#demo` is on this page, and routing
  // through Next to reach it would re-render the route to scroll.
  return (
    <a href="#demo" className={className}>
      <MonitorPlay className="size-4" aria-hidden />
      {label}
    </a>
  );
}

/** Plain language, per §8 — "1 site · 12 months of updates", not a field dump. */
function licenceSummary(pkg: DetailLicencePackage): string {
  const parts = [
    pkg.activationLimit === 1
      ? "1 installation"
      : pkg.activationLimit >= 999
        ? "unlimited installations"
        : `${pkg.activationLimit} installations`,
    `${pkg.updateMonths} months of updates`,
    `${pkg.supportMonths} months of support`,
  ];
  return parts.join(" · ");
}
