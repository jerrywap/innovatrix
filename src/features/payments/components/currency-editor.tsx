"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setProviderCurrenciesAction } from "../actions";

/**
 * Which currencies this account takes — editable, where it used to be a
 * read-only line of text.
 *
 * The text said what the *provider* supports worldwide. Routing believed it,
 * and a merchant enabled for NGN alone still had USD orders sent to Paystack,
 * which refused them in its own words at the last click of checkout.
 *
 * Offered as the driver's full list with the account's subset ticked, so the
 * narrowing reads as a decision somebody made rather than a fact about the
 * world. Unticking everything is allowed and means "not configured yet" — the
 * service reads an empty list as the driver's default rather than as "none",
 * because a provider that silently supports nothing is a worse failure than the
 * one this replaces.
 */
export function CurrencyEditor({
  provider,
  available,
  selected,
}: {
  provider: string;
  /** Everything the driver can do — the ceiling, enforced again server-side. */
  available: string[];
  /** What this account is set to take today. */
  selected: string[];
}) {
  const [state, formAction] = useActionState(setProviderCurrenciesAction, null);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <input type="hidden" name="provider" value={provider} />

      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <legend className="sr-only">Currencies {provider} can take on this account</legend>
        {available.map((currency) => (
          <label key={currency} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name="currencies"
              value={currency}
              defaultChecked={selected.includes(currency)}
              className="accent-[var(--signal)]"
            />
            <span className="font-mono text-[11.5px]">{currency}</span>
          </label>
        ))}
      </fieldset>

      <Save />

      {state && !state.ok && (
        <span role="alert" className="text-[11.5px] text-[var(--danger)]">
          {state.error}
        </span>
      )}
      {state?.ok && <span className="text-subtle text-[11.5px]">Saved.</span>}
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border hover:bg-surface-muted rounded-lg border px-2.5 py-1 text-[11.5px] disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
