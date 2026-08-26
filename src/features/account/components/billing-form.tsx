"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { COUNTRIES, countryLabel } from "@/lib/countries";
import { Field, FormErrors } from "@/features/products/components/section-form";
import { saveBillingDetailsAction } from "../actions";

/**
 * The address that goes on an invoice.
 *
 * These fields were collected once, at checkout, and then unreachable — the only
 * way to correct a typo in a VAT number was to place another order. The same
 * schema validates both, so the two cannot disagree about what is required.
 *
 * The country is a `<select>` here where checkout uses a two-letter text input.
 * Checkout is deliberately terse — §13's "resist adding steps" — but this form is
 * a correction rather than a step, and picking from a list is how somebody
 * discovers we spell it "GB" and not "UK".
 */
export function BillingDetailsForm({
  defaults,
  currency,
}: {
  defaults: {
    email: string;
    line1: string;
    line2: string;
    city: string;
    region: string;
    postcode: string;
    country: string;
    taxId: string;
  };
  currency: string;
}) {
  const [state, submit, pending] = useActionState(saveBillingDetailsAction, null);

  return (
    <form action={submit} className="flex flex-col gap-5">
      {state?.ok === false && (
        <FormErrors
          error={state.error}
          {...(state.fieldErrors ? { fieldErrors: state.fieldErrors } : {})}
        />
      )}

      <Field
        label="Billing email"
        htmlFor="billing-email"
        hint="Where invoices and receipts go. It can differ from your sign-in address."
        required
      >
        <Input
          id="billing-email"
          name="email"
          type="email"
          defaultValue={defaults.email}
          required
          autoComplete="email"
        />
      </Field>

      <Field label="Address" htmlFor="billing-line1" required>
        <Input
          id="billing-line1"
          name="line1"
          defaultValue={defaults.line1}
          required
          maxLength={200}
          autoComplete="address-line1"
          placeholder="Street address"
        />
      </Field>

      <Field label="Address line 2" htmlFor="billing-line2">
        <Input
          id="billing-line2"
          name="line2"
          defaultValue={defaults.line2}
          maxLength={200}
          autoComplete="address-line2"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Town or city" htmlFor="billing-city" required>
          <Input
            id="billing-city"
            name="city"
            defaultValue={defaults.city}
            required
            maxLength={120}
            autoComplete="address-level2"
          />
        </Field>

        <Field label="County or state" htmlFor="billing-region">
          <Input
            id="billing-region"
            name="region"
            defaultValue={defaults.region}
            maxLength={120}
            autoComplete="address-level1"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Postcode" htmlFor="billing-postcode">
          <Input
            id="billing-postcode"
            name="postcode"
            defaultValue={defaults.postcode}
            maxLength={40}
            autoComplete="postal-code"
          />
        </Field>

        <Field
          label="Country"
          htmlFor="billing-country"
          hint="This decides which tax applies."
          required
        >
          {/*
            `NativeSelect`, not the Radix `Select`. A Radix control inside
            `<form action={fn}>` is restored to a stale ref by React 19's
            pre-action form reset — the failure `section-form.tsx` documents,
            where "only the dropdowns misbehave". A native select has none of
            that and works with JavaScript off.
          */}
          <NativeSelect
            id="billing-country"
            name="country"
            defaultValue={defaults.country || "GB"}
            required
            autoComplete="country"
          >
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {countryLabel(country)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field
        label="Tax ID"
        htmlFor="billing-taxid"
        hint="A VAT or tax number, if you have one. Leave it empty to remove it."
      >
        <Input id="billing-taxid" name="taxId" defaultValue={defaults.taxId} maxLength={60} />
      </Field>

      <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save billing details"}
        </Button>
        {state?.ok && (
          <span role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300">
            Saved.
          </span>
        )}
        <span className="text-subtle ml-auto text-[12px]">
          Invoiced in <span className="font-mono">{currency}</span>
        </span>
      </div>
    </form>
  );
}
