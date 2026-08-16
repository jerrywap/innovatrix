"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FormErrors } from "@/features/products/components/section-form";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import { saveDiscountAction } from "../actions";

/**
 * Create a discount code.
 *
 * ## Amounts are typed in major units
 *
 * `50` means £50 and `15` means 15%. The conversion to minor units and basis
 * points happens once, in the action — deliberately not here, because a `× 100`
 * in a component is the mistake that ships a promotion at a hundredth of its
 * intended value and looks fine in review.
 *
 * The currency field appears only for a fixed discount, because "£50 off" needs
 * one and "15% off" does not.
 */
export function DiscountForm() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"fixed" | "percentage">("percentage");
  const [state, formAction] = useActionState(saveDiscountAction, null);
  const failed = state && !state.ok ? state : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border hover:bg-surface-muted flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-[13px]"
      >
        <Plus className="size-3.5" aria-hidden />
        New discount code
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4"
    >
      <FieldGroup
        title="New discount code"
        description="Available at checkout as soon as it's saved."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Code"
            htmlFor="code"
            hint="What the customer types. Letters, numbers, hyphens."
          >
            <Input
              id="code"
              name="code"
              required
              maxLength={40}
              placeholder="LAUNCH15"
              className="font-mono uppercase"
            />
          </Field>

          <Field label="Description" htmlFor="description" hint="For staff, not customers.">
            <Input id="description" name="description" maxLength={300} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type" htmlFor="kind">
            <select
              id="kind"
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as "fixed" | "percentage")}
              className="border-border bg-background h-9 w-full rounded-lg border px-2.5 text-[13px]"
            >
              <option value="percentage">Percentage off</option>
              <option value="fixed">Fixed amount off</option>
            </select>
          </Field>

          <Field
            label={kind === "percentage" ? "Percent" : "Amount"}
            htmlFor="value"
            hint={kind === "percentage" ? "15 means 15%." : "50 means 50.00."}
          >
            <Input
              id="value"
              name="value"
              required
              placeholder={kind === "percentage" ? "15" : "50"}
            />
          </Field>

          {kind === "fixed" && (
            <Field
              label="Currency"
              htmlFor="currency"
              hint="A fixed amount needs one — £50 and ₦50 are not the same offer."
            >
              <select
                id="currency"
                name="currency"
                className="border-border bg-background h-9 w-full rounded-lg border px-2.5 text-[13px]"
              >
                {STOREFRONT_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Minimum spend" htmlFor="minSpend" hint="Optional. In major units.">
            <Input id="minSpend" name="minSpend" placeholder="300" />
          </Field>

          <Field
            label="Total uses"
            htmlFor="usageLimit"
            hint="Optional. Blank means unlimited."
          >
            <Input id="usageLimit" name="usageLimit" inputMode="numeric" placeholder="100" />
          </Field>

          <Field label="Per customer" htmlFor="perCustomerLimit" hint="Optional.">
            <Input
              id="perCustomerLimit"
              name="perCustomerLimit"
              inputMode="numeric"
              placeholder="1"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Starts" htmlFor="startsAt">
            <Input id="startsAt" name="startsAt" type="date" />
          </Field>

          <Field label="Expires" htmlFor="expiresAt">
            <Input id="expiresAt" name="expiresAt" type="date" />
          </Field>

          <Field
            label="Categories"
            htmlFor="categorySlugs"
            hint="Comma-separated slugs. Blank applies to everything."
          >
            <Input id="categorySlugs" name="categorySlugs" placeholder="crm, finance" />
          </Field>
        </div>
      </FieldGroup>

      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}
      {state?.ok && (
        <p role="status" className="text-[13px] text-emerald-700 dark:text-emerald-300">
          Saved.
        </p>
      )}

      <div className="flex gap-2">
        <Save />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-subtle px-3 py-1.5 text-[12.5px]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-foreground text-background rounded-lg px-4 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
    >
      {pending ? "Saving…" : "Create code"}
    </button>
  );
}
