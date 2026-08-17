"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { TriangleAlert } from "lucide-react";
import { setCurrencyRoutingAction } from "../actions";
import type { CurrencyRoutingView } from "../settings-view";

/**
 * One currency's routing.
 *
 * The `<select>` lists only providers that could **actually** serve this
 * currency right now — enabled, supporting it, and with a key present. Offering
 * a provider that would be skipped at checkout is how a routing table comes to
 * disagree with what the resolver does.
 */
export function RoutingRow({ route }: { route: CurrencyRoutingView }) {
  const [state, formAction] = useActionState(setCurrencyRoutingAction, null);

  /*
   * An uncovered currency used to render as a read-only line with no form at
   * all — locking the admin out at exactly the moment they came to fix it.
   * The warning stays; the controls come back when there is something to pick.
   */
  if (!route.covered) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-12 font-mono text-[13px] font-medium">{route.currency}</span>
        <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--danger)]">
          <TriangleAlert className="size-3.5" aria-hidden />
          No enabled provider takes this currency
          {route.primary ? ` — ${route.primary} is saved but cannot be used` : ""}.
        </span>
        <span className="text-subtle text-[11.5px]">
          Enable one above, or tick this currency on an account that takes it.
        </span>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="currency" value={route.currency} />
      <span className="min-w-12 font-mono text-[13px] font-medium">{route.currency}</span>

      <label className="flex items-center gap-2 text-[12.5px]">
        <span className="text-subtle">First</span>
        <select
          name="primary"
          /*
           * A stored primary outside `available` matches no option, so the
           * browser shows the first one — the screen then displays a route
           * nobody chose, and saving writes it. `stalePrimary` says so out loud
           * instead; the select falls back to what will actually be used.
           */
          defaultValue={
            route.primary && route.available.includes(route.primary)
              ? route.primary
              : route.available[0]
          }
          className="border-border bg-background h-8 rounded-lg border px-2 text-[12.5px]"
        >
          {route.available.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>

      {route.stalePrimary && (
        <span className="flex items-center gap-1.5 text-[12px] text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          Saved as {route.primary}, which can&rsquo;t take {route.currency}. Saving replaces it.
        </span>
      )}

      {route.available.length > 1 && (
        <fieldset className="flex items-center gap-2 text-[12.5px]">
          <legend className="text-subtle sr-only">Fallbacks for {route.currency}</legend>
          <span className="text-subtle">then</span>
          {route.available.map((key) => (
            <label key={key} className="flex items-center gap-1">
              <input
                type="checkbox"
                name="fallbacks"
                value={key}
                defaultChecked={route.fallbacks.includes(key)}
                className="accent-[var(--signal)]"
              />
              <span className="font-mono text-[11.5px]">{key}</span>
            </label>
          ))}
        </fieldset>
      )}

      <Save />

      {state && !state.ok && (
        <span role="alert" className="text-[11.5px] text-[var(--danger)]">
          {state.error}
        </span>
      )}
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border hover:bg-surface-muted ml-auto rounded-lg border px-3 py-1.5 text-[12.5px] disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
