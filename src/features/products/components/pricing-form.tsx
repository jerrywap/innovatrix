"use client";

import { useState } from "react";
import { Gift } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldGroup, SectionForm, type SectionFormProps } from "./section-form";
import { MoneyInput, toDecimalString } from "./money-input";
import { Repeater } from "./repeater";
import { savePricingAction } from "../actions";
import { STOREFRONT_CURRENCIES, type StorefrontCurrency } from "@/config/storefront";
import { CURRENCIES } from "@/lib/money";
import { SLUG_INPUT_ATTRS } from "@/validators/common";
import { ADDON_PRICING_TYPES, LICENCE_TYPES } from "@/lib/db/enums";
import type {
  AddonView,
  AdminProductView,
  LicencePackageView,
  PriceView,
} from "@/services/catalog/product-view";

/**
 * Prices, licence packages and add-ons — §43, §49, §65.
 *
 * ## Prices are fixed rows, keyed by currency
 *
 * One row per storefront currency, named `prices[GBP]` rather than
 * `prices[0][currency]` + `prices[0][amount]`. Two things follow, and both
 * matter:
 *
 * 1. **Nothing can misalign.** With indexed pairs, leaving one amount blank
 *    shifts every later amount up a row — NGN silently takes the USD price.
 *    With a currency-keyed map there is no pairing to get wrong.
 * 2. **"Not sold here" is expressible.** §43 wants a price in each currency
 *    *or* an explicit statement that the product is unavailable in it. An empty
 *    field says exactly that, which is what an administrator would do anyway.
 *
 * Amounts are typed as decimals and converted server-side by `fromDecimal`,
 * which knows each currency's exponent. The client never multiplies by 100.
 *
 * `action` is a prop so this form serves both wizard surfaces — vendor ticket 04.
 * Defaulted to the staff action, so every existing caller is unchanged and the
 * vendor pages pass their own. A second copy of the form per surface is how one of
 * them quietly stops having a field the other has.
 */
export function PricingForm({
  product,
  nextHref,
  action = savePricingAction,
}: {
  product: AdminProductView;
  nextHref: string;
  action?: SectionFormProps["action"];
}) {
  return (
    <SectionForm action={action} productId={product.id} nextHref={nextHref}>
      {/*
        There is no product-level price input any more.
        
        There were two independent price stores and nothing reconciled them:
        `readiness.ts` states it outright — "the marketplace advertises from
        `product.prices`; the cart charges from `licencePackages[].prices`" — and
        the licence package always won, because `product.prices` never became
        money. No cart line, no order line, no payment reads it.
        
        Asking for the same number twice is how a vendor ends up with a listing
        that advertises £299 and a basket that refuses. `product.prices` is now
        **derived** from the cheapest package in `PRICING_SECTION.toUpdate`, so the
        two cannot disagree by construction — which also retires the
        `unbuyable_currency` publish gate that existed only to police the gap.
      */}
      <FieldGroup
        title="Licence packages"
        description="What a customer actually buys, and what they are charged. The marketplace advertises your cheapest package."
      >
        <Repeater
          initial={product.licencePackages}
          blank={blankPackage}
          addLabel="Add another package"
          min={1}
          minLabel="A product needs at least one package — this is the only thing a customer can buy."
          max={12}
          row={(pkg, index) => <LicencePackageRow pkg={pkg} index={index} />}
        />
      </FieldGroup>

      <FieldGroup
        title="Service add-ons"
        description="Installation, branding, data migration — the things sold alongside."
      >
        <Repeater
          initial={product.addons}
          blank={blankAddon}
          addLabel="Add a service"
          emptyLabel="No add-ons offered."
          max={20}
          row={(addon, index) => <AddonRow addon={addon} index={index} />}
        />
      </FieldGroup>
    </SectionForm>
  );
}

/**
 * What a blank means, per place this control appears.
 *
 * One sentence was shown at all four call sites, and it was only true at one of
 * them. Keeping the copy here, keyed, is what makes it impossible to show the
 * wrong one: the `context` prop below has **no default**, so the compiler names
 * every call site the day a fifth is added.
 *
 * ## The `product` entry used to be a lie
 *
 * It said *"If you want to list this product as 'Free', then leave the price
 * blank."* In this codebase a blank produces **no price row** (`priceMapSchema`
 * skips it), and every renderer reads a missing row as **"Price on request"** —
 * `card-mapper`, `product-card`, `purchase-panel` all agree — while `FreeBadge`
 * fires only on `amount === 0`. So following that instruction produced the
 * opposite of what it promised, and the form refused to save besides.
 *
 * Free is now a **button**, not the absence of a value, and every entry below
 * says the same thing about a blank: it withdraws the currency.
 */
const BLANK_MEANS = {
  product: (
    <>
      Leave a currency blank to not sell in it — the marketplace shows &ldquo;Price on
      request&rdquo;. For a free product use the button above, which writes a zero.
    </>
  ),
  licencePackage: (
    <>
      Every currency you sell in needs an amount here, or this package shows as &ldquo;On
      request&rdquo; and cannot be bought. Use the button above to make it free.
    </>
  ),
  addon: (
    <>
      Leave every currency blank for a quote-required service. Any amount makes it buyable, and
      the button above makes it a free extra.
    </>
  ),
} satisfies Record<string, React.ReactNode>;

export type PriceMatrixContext = keyof typeof BLANK_MEANS;

/**
 * One input per storefront currency; blank means whatever `context` says it means.
 *
 * Exported because the template-sibling panel needs the same control. Duplicating
 * fifteen lines would duplicate the sentence that makes "not sold here"
 * expressible, and that sentence is the whole reason a blank is not a zero.
 */
export function PriceMatrix({
  name,
  prices,
  context,
}: {
  name: string;
  prices: readonly PriceView[];
  /** Required, undefaulted — see `BLANK_MEANS`. */
  context: PriceMatrixContext;
}) {
  /*
   * The values live here, not in each `MoneyInput`, so "Mark as free" can write
   * every currency at once. Seeded from what is stored; a decimal string per
   * currency, because that is what the input posts and what `fromDecimal` expects.
   */
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const byCurrency = new Map(prices.map((price) => [price.currency, price.amount]));
    return Object.fromEntries(
      STOREFRONT_CURRENCIES.map((currency) => {
        const amount = byCurrency.get(currency);
        const exponent = CURRENCIES[currency as StorefrontCurrency].exponent;
        return [currency, amount === undefined ? "" : toDecimalString(amount, exponent)];
      }),
    );
  });

  const setEvery = (next: (currency: string) => string) =>
    setAmounts(Object.fromEntries(STOREFRONT_CURRENCIES.map((c) => [c, next(c)])));

  const isFree =
    STOREFRONT_CURRENCIES.every((c) => Number(amounts[c] ?? "") === 0) &&
    STOREFRONT_CURRENCIES.every((c) => (amounts[c] ?? "").trim() !== "");

  return (
    <div className="flex flex-col gap-2.5">
      {/*
        Free is a button because it is a *decision*, not a number somebody happens
        to type — and because the instruction it replaces ("leave the price blank")
        was false. A zero in every currency is what the storefront reads as free;
        `FreeBadge` fires on `amount === 0` and on nothing else.

        `aria-pressed` rather than a checkbox: it sets three fields and is not
        itself a field, so there is nothing for a checkbox to submit.
      */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={isFree}
          onClick={() =>
            isFree
              ? setEvery(() => "")
              : setEvery((c) => (0).toFixed(CURRENCIES[c as StorefrontCurrency].exponent))
          }
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition ${
            isFree
              ? "border-[var(--signal)] text-[var(--signal-text)]"
              : "border-border hover:bg-surface-muted text-muted-foreground"
          }`}
        >
          <Gift className="size-3" aria-hidden />
          {isFree ? "Free — click to set a price" : "Mark as free"}
        </button>
      </div>

      {STOREFRONT_CURRENCIES.map((currency) => (
        <MoneyInput
          key={currency}
          name={`${name}[${currency}]`}
          currency={currency as StorefrontCurrency}
          value={amounts[currency] ?? ""}
          onValueChange={(next) => setAmounts((current) => ({ ...current, [currency]: next }))}
        />
      ))}
      <p className="text-subtle text-[12.5px]">{BLANK_MEANS[context]}</p>
    </div>
  );
}

function LicencePackageRow({ pkg, index }: { pkg: LicencePackageView; index: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium">Name</span>
          <Input
            name={`licencePackages[${index}][name]`}
            defaultValue={pkg.name}
            placeholder="Single installation"
            required
            maxLength={80}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium">
            Key <span className="text-subtle font-normal">— lowercase, used by the cart</span>
          </span>
          {/*
            `SLUG_INPUT_ATTRS` rather than a hand-written `pattern` — vendor ticket 04's fields
            each had one and none had a `title`, so the browser said "Please match the requested
            format." and never said what the format was.
          */}
          <Input
            name={`licencePackages[${index}][key]`}
            defaultValue={pkg.key}
            placeholder="single"
            required
            {...SLUG_INPUT_ATTRS}
            className="font-mono text-[13px]"
          />
        </label>
      </div>

      {/*
        The description had a schema field, a stored value, and two readers —
        `AdminProductView` and the public `detail` DTO — and no input anywhere. So it
        was permanently blank on every product, and the purchase panel showed a
        package name with nothing under it. Added rather than deleted: the readers
        exist and a tier is exactly the thing that needs a sentence.
      */}
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium">
          What this includes <span className="text-subtle font-normal">— optional</span>
        </span>
        <Textarea
          name={`licencePackages[${index}][description]`}
          defaultValue={pkg.description ?? ""}
          rows={2}
          maxLength={400}
          placeholder="One production site, twelve months of updates and email support."
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium">Licence type</span>
        <Select name={`licencePackages[${index}][licenceType]`} defaultValue={pkg.licenceType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LICENCE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <div className="grid gap-2 sm:grid-cols-3">
        {/*
          The bounds are the schema's bounds. They used to be `min={0} max={10_000}`
          for all three while `licencePackageFormSchema` asks for `1…10_000`,
          `0…120` and `0…120` — so the browser accepted 0 activations and 900 months
          of support, and the server refused them. A form that says yes and an
          action that says no about the same value is the worst of both.
        */}
        <NumberField
          name={`licencePackages[${index}][activationLimit]`}
          label="Activations"
          defaultValue={pkg.activationLimit}
          min={1}
          max={10_000}
        />
        <NumberField
          name={`licencePackages[${index}][supportMonths]`}
          label="Support (months)"
          defaultValue={pkg.supportMonths}
          min={0}
          max={120}
        />
        <NumberField
          name={`licencePackages[${index}][updateMonths]`}
          label="Updates (months)"
          defaultValue={pkg.updateMonths}
          min={0}
          max={120}
        />
      </div>

      <div>
        <p className="text-[12.5px] font-medium">Price</p>
        <div className="mt-1.5">
          <PriceMatrix
            name={`licencePackages[${index}][prices]`}
            prices={pkg.prices}
            context="licencePackage"
          />
        </div>
      </div>
    </div>
  );
}

function AddonRow({ addon, index }: { addon: AddonView; index: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium">Name</span>
          <Input
            name={`addons[${index}][name]`}
            defaultValue={addon.name}
            placeholder="Installation"
            required
            maxLength={80}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium">
            Key <span className="text-subtle font-normal">— lowercase</span>
          </span>
          <Input
            name={`addons[${index}][key]`}
            defaultValue={addon.key}
            placeholder="installation"
            required
            {...SLUG_INPUT_ATTRS}
            className="font-mono text-[13px]"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium">How it is priced</span>
        <Select name={`addons[${index}][pricingType]`} defaultValue={addon.pricingType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADDON_PRICING_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium">Description</span>
        <Textarea
          name={`addons[${index}][description]`}
          defaultValue={addon.description ?? ""}
          rows={2}
          maxLength={400}
        />
      </label>

      <div>
        {/* The "leave blank" rider moved into `BLANK_MEANS.addon`, so it is stated
            once, beside the fields it describes, rather than twice with a gap. */}
        <p className="text-[12.5px] font-medium">Price</p>
        <div className="mt-1.5">
          <PriceMatrix
            name={`addons[${index}][prices]`}
            prices={addon.prices}
            context="addon"
          />
        </div>
      </div>
    </div>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
  min,
  max,
}: {
  name: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium">{label}</span>
      <Input name={name} type="number" min={min} max={max} defaultValue={defaultValue} />
    </label>
  );
}

function blankPackage(): LicencePackageView {
  return {
    key: "",
    name: "",
    licenceType: "single_installation",
    activationLimit: 1,
    supportMonths: 12,
    updateMonths: 12,
    prices: [],
  };
}

function blankAddon(): AddonView {
  return { key: "", name: "", pricingType: "fixed", prices: [] };
}
