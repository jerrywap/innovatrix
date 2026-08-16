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
import { FieldGroup, SectionForm } from "./section-form";
import { MoneyInput } from "./money-input";
import { Repeater } from "./repeater";
import { savePricingAction } from "../actions";
import { STOREFRONT_CURRENCIES, type StorefrontCurrency } from "@/config/storefront";
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
 */
export function PricingForm({
  product,
  nextHref,
}: {
  product: AdminProductView;
  nextHref: string;
}) {
  return (
    <SectionForm action={savePricingAction} productId={product.id} nextHref={nextHref}>
      <FieldGroup
        title="Price"
        description="Set each currency deliberately — nothing is converted from a rate."
      >
        <PriceMatrix name="prices" prices={product.prices} />
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
        description="Installation, branding, data migration — the things sold alongside (§49)."
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

/** One input per storefront currency; blank means "not sold in this one". */
function PriceMatrix({ name, prices }: { name: string; prices: readonly PriceView[] }) {
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
      <p className="text-subtle text-[12.5px]">
        Leave a currency blank to not sell in it. The marketplace shows &ldquo;price on
        request&rdquo; rather than a zero.
      </p>
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
            Key <span className="text-subtle font-normal">— used by the cart</span>
          </span>
          <Input
            name={`licencePackages[${index}][key]`}
            defaultValue={pkg.key}
            placeholder="single"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
            maxLength={80}
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
        <NumberField
          name={`licencePackages[${index}][activationLimit]`}
          label="Activations"
          defaultValue={pkg.activationLimit}
        />
        <NumberField
          name={`licencePackages[${index}][supportMonths]`}
          label="Support (months)"
          defaultValue={pkg.supportMonths}
        />
        <NumberField
          name={`licencePackages[${index}][updateMonths]`}
          label="Updates (months)"
          defaultValue={pkg.updateMonths}
        />
      </div>

      <div>
        <p className="text-[12.5px] font-medium">Price</p>
        <div className="mt-1.5">
          <PriceMatrix name={`licencePackages[${index}][prices]`} prices={pkg.prices} />
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
          <span className="text-[12.5px] font-medium">Key</span>
          <Input
            name={`addons[${index}][key]`}
            defaultValue={addon.key}
            placeholder="installation"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
            maxLength={80}
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
        <p className="text-[12.5px] font-medium">
          Price{" "}
          <span className="text-subtle font-normal">
            — leave blank for a quote-required service
          </span>
        </p>
        <div className="mt-1.5">
          <PriceMatrix name={`addons[${index}][prices]`} prices={addon.prices} />
        </div>
      </div>
    </div>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium">{label}</span>
      <Input name={name} type="number" min={0} max={10_000} defaultValue={defaultValue} />
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
