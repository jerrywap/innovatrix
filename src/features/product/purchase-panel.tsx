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
  /**
   * Is there anything at all on `/preview/{slug}` — a live demo **or** a
   * screenshot?
   *
   * Computed in `purchase-section` from the full `ProductDetail`, and passed as
   * a boolean rather than the media itself: this component is handed a
   * three-field view precisely so nothing larger can drift into the client
   * bundle behind it, and a screenshot array would be the first thing to.
   */
  previewable: boolean;
}
import type {
  DetailAddon,
  DetailLicencePackage,
  DetailPrice,
} from "@/services/marketplace/detail";
import { productHref } from "@/config/catalogue";

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
        {/*
          Preview first, then the money, then the alternatives — the order
          somebody actually buys in. It used to sit third, under both purchase
          buttons, which put "decide" above "look".
        */}
        <PreviewDemo demo={demo} slug={slug} />

        {total === 0 && chosenAddons.size === 0 ? (
          <GetItFree
            productId={productId}
            {...(selectedKey ? { licencePackageKey: selectedKey } : {})}
            signedIn={signedIn}
            owned={owned}
            productPath={productHref(slug)}
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
 * The first CTA — look before you decide.
 *
 * ## It goes to our own page now
 *
 * This was an outbound `target="_blank"` anchor straight to the vendor's demo:
 * the visitor left CoSetup, landed somewhere with no way back but the Back
 * button, and had no way to see a template at phone width. `/preview/{slug}`
 * frames it instead, with our bar around it and a width switcher — and the
 * leaving still happens, one level in, from a control that page owns.
 *
 * So no `target="_blank"`, no `rel`, and no "(opens in a new tab)": a `<Link>`
 * to a route of ours, like every other internal navigation.
 *
 * ## It renders far more often than it used to
 *
 * The old condition was "a demo URL or credentials exist", which is **five of a
 * thousand published products** and none of the 135 templates. `previewable` is
 * the honest question instead — is there anything on that page at all — and the
 * preview falls back to screenshots, which every product has.
 *
 * It can still render nothing: a product with neither a demo nor a screenshot
 * has nothing to show, and a greyed-out button is a promise the product cannot
 * keep.
 *
 * ## What it is not allowed to know
 *
 * This is a **client component**, so anything it receives is in the RSC payload
 * — which is exactly the leak `DemoPanel`'s two-function split exists to
 * prevent. It gets a URL, two booleans and a count, and `previewable` is a
 * boolean rather than the media array for the same reason.
 */
function PreviewDemo({ demo, slug }: { demo: DemoCta; slug: string }) {
  if (!demo.previewable) return null;

  return (
    <Link
      href={`/preview/${slug}` as Route}
      className="border-border hover:bg-surface-muted flex items-center justify-center gap-2 rounded-full border px-5 py-3 text-[14px] font-medium transition"
    >
      <MonitorPlay className="size-4" aria-hidden />
      Preview Demo
    </Link>
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
