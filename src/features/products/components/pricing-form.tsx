"use client";

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
import { MoneyInput } from "./money-input";
import { Repeater } from "./repeater";
import { savePricingAction } from "../actions";
import { STOREFRONT_CURRENCIES, type StorefrontCurrency } from "@/config/storefront";
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
      <FieldGroup title="Price" description="Set each currency price.">
        <PriceMatrix name="prices" prices={product.prices} context="product" />
      </FieldGroup>

      <FieldGroup
        title="Licence packages"
        description="What a customer actually buys. At least one is needed before publishing — without it there is nothing to add to a cart."
      >
        <Repeater
          initial={product.licencePackages}
          blank={blankPackage}
          addLabel="Add a licence package"
          emptyLabel="No packages yet. A published product needs at least one."
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
 * them: *"Leave a currency blank to not sell in it. The marketplace shows 'price
 * on request' rather than a zero."* On a **licence package** row a blank does not
 * mean "not sold" — it means the package is unbuyable in that currency and
 * publishing is refused (`unbuyable_currency`). On an **add-on** row a blank is
 * how a quote-required service is expressed, so "not sold in it" reads as the
 * opposite of what it does. It also never mentioned Free, which is what a zero
 * actually renders as, and it was the one place the phrase was lowercase while
 * every customer-facing surface capitalises it.
 *
 * Keeping the copy here, keyed, is what makes it impossible to show the wrong
 * one: the `context` prop below has **no default**, so the compiler names every
 * call site the day a fifth is added. A default is how one sentence stayed wrong
 * in three places.
 */
const BLANK_MEANS = {
  product: (
    <>If you want to list this product as &ldquo;Free&rdquo;, then leave the price blank.</>
  ),
  licencePackage: (
    <>
      Every currency you sell the product in needs an amount here, or this package shows as
      &ldquo;On request&rdquo; and cannot be published. A zero shows as &ldquo;Free&rdquo;.
    </>
  ),
  addon: (
    <>
      Leave every currency blank for a quote-required service. Any amount here makes it buyable,
      and a zero makes it a free extra.
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
  const byCurrency = new Map(prices.map((price) => [price.currency, price.amount]));

  return (
    <div className="flex flex-col gap-2">
      {STOREFRONT_CURRENCIES.map((currency) => (
        <MoneyInput
          key={currency}
          name={`${name}[${currency}]`}
          currency={currency as StorefrontCurrency}
          defaultAmount={byCurrency.get(currency)}
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
