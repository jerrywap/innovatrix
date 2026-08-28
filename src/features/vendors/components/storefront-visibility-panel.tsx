"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  STOREFRONT_FIELDS,
  STOREFRONT_FIELD_LABELS,
  type StorefrontField,
} from "@/config/storefront";
import { saveStorefrontDefaultsAction, setStorefrontVisibilityAction } from "../actions";

/**
 * What a storefront is allowed to show — the staff end of the two-level rule.
 *
 * ## Why staff need this at all
 *
 * A vendor's website URL is validated as a URL and published; there is no
 * approval queue for profile changes. So until now the only lever over a link
 * being abused was `vendor.suspend`, which unlists the vendor's whole catalogue.
 * This is the control between "fine" and "gone", and it is per field so pulling
 * a link does not also take down their logo.
 *
 * ## Radios, not switches, and that is the whole design
 *
 * A `Switch` has two states and there are **three**: follow the platform
 * default, always show, always hide. Losing the first one is not cosmetic —
 * "shown, because nobody has decided" and "shown, because staff decided" behave
 * differently the moment the platform default changes, and only one of them
 * should follow it.
 *
 * ## Two forms, one component
 *
 * Unlike `commission-form.tsx`, which splits into two because "empty means
 * inherit" and "empty is invalid" are different promises, these two are the
 * *same* promise at two scopes — the platform row is what the vendor row falls
 * back to, and both submit the same three choices. Splitting them would be two
 * copies of one tri-state to keep in step.
 */

type Choice = "default" | "show" | "hide";

const CHOICES: ReadonlyArray<{ value: Choice; label: string }> = [
  { value: "default", label: "Use default" },
  { value: "show", label: "Always show" },
  { value: "hide", label: "Always hide" },
];

/** One vendor's overrides, on the staff vendor screen. */
export function StorefrontVisibilityPanel({
  vendorId,
  current,
  platform,
}: {
  vendorId: string;
  /** Only the fields this vendor has an override for. Absent ⇒ "Use default". */
  current: Partial<Record<StorefrontField, boolean>>;
  /** What "Use default" currently resolves to, so the option can say so. */
  platform: Readonly<Record<StorefrontField, boolean>>;
}) {
  const [state, submit] = useActionState(setStorefrontVisibilityAction, null);

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="vendorId" value={vendorId} />

      <p className="text-muted-foreground text-[13px]">
        Everything here is supplied by the vendor. Hiding a field removes it from their public
        storefront and from its structured data — the vendor keeps the value and can still edit
        it, and they are told on their own storefront preview.
      </p>

      <FieldRows
        name="fields"
        valueFor={(field) => choiceOf(current[field])}
        platform={platform}
      />

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && <p className="text-subtle text-[12.5px]">Saved.</p>}

      <Submit />
    </form>
  );
}

/** The platform-wide defaults, on `/admin/settings`. */
export function StorefrontDefaultsForm({
  current,
}: {
  current: Partial<Record<StorefrontField, boolean>>;
}) {
  const [state, submit] = useActionState(saveStorefrontDefaultsAction, null);

  return (
    <form
      action={submit}
      className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4"
    >
      <h2 className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em]">
        <Eye className="text-subtle size-4" aria-hidden />
        What vendor storefronts show
      </h2>

      <p className="text-muted-foreground text-[13px]">
        Applies to every vendor who has no setting of their own. A vendor set to “Always show”
        or “Always hide” on their own record keeps that, whatever is chosen here.
      </p>

      <FieldRows name="fields" valueFor={(field) => choiceOf(current[field])} />

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && <p className="text-subtle text-[12.5px]">Saved.</p>}

      <Submit />
    </form>
  );
}

/**
 * One row per field.
 *
 * Native `<input type="radio">`, deliberately — the form uses `<form action={fn}>`,
 * and AGENTS.md's rule is that a Radix control there answers React's pre-action
 * `form.reset()` by restoring a stale ref. Native inputs are unaffected because
 * React writes their fresh `defaultChecked` in the same commit, so this form
 * needs none of `useManualSubmit`'s machinery.
 */
function FieldRows({
  name,
  valueFor,
  platform,
}: {
  name: string;
  valueFor: (field: StorefrontField) => Choice;
  /** Omitted on the platform form, where "Use default" has nothing beneath it. */
  platform?: Readonly<Record<StorefrontField, boolean>>;
}) {
  return (
    <ul className="border-border divide-border divide-y overflow-hidden rounded-xl border">
      {STOREFRONT_FIELDS.map((field) => {
        const selected = valueFor(field);

        return (
          <li
            key={field}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 p-3"
          >
            <span className="text-[13.5px] font-medium">{STOREFRONT_FIELD_LABELS[field]}</span>

            {/*
              A `<fieldset>` with an `sr-only` legend, so a screen reader hears which
              field these three belong to. Without it the group is three unlabelled
              radios repeated five times.
            */}
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-0 p-0">
              <legend className="sr-only">
                {STOREFRONT_FIELD_LABELS[field]} on the public storefront
              </legend>

              {CHOICES.map((choice) => (
                <label key={choice.value} className="flex items-center gap-1.5 text-[12.5px]">
                  <input
                    type="radio"
                    name={`${name}.${field}`}
                    value={choice.value}
                    defaultChecked={selected === choice.value}
                    className="accent-[var(--signal)]"
                  />
                  {choice.value === "default" && platform
                    ? `Use default (${platform[field] ? "shown" : "hidden"})`
                    : choice.label}
                </label>
              ))}
            </fieldset>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * `undefined` → `"default"`, and `false` is **not** `"default"`.
 *
 * The one line where a falsy check would silently break the tri-state: an
 * explicit "always hide" would render as "Use default", and saving the form
 * would then clear the decision staff had just made.
 */
function choiceOf(value: boolean | undefined): Choice {
  if (value === undefined) return "default";
  return value ? "show" : "hide";
}

function Submit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" className="w-fit" disabled={pending}>
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Save
    </Button>
  );
}
