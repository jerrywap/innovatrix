"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { NativeSelect } from "@/components/native-select";
import type { MarketplaceSort } from "@/services/marketplace/pipeline";

/**
 * Sort, as one control instead of four links.
 *
 * ## The form is the mechanism; the router is the enhancement
 *
 * Same shape as `search-box.tsx` in this directory, and for the same reason it
 * gives: a native `<form method="get">` is what makes this work before hydration
 * and with JavaScript off, which the rest of the rail gets for free by being made
 * of links. `onSubmit` then preventDefaults and pushes, so the ordinary case is a
 * soft navigation rather than a document load.
 *
 * A Radix `Select` was the obvious alternative and was rejected: it is
 * client-only, and it would have been the first control in this rail that does
 * nothing before hydration. The rail's docblock stakes three properties on that,
 * and a sort control is not what to spend them on.
 *
 * ## The URL is serialised from the form, not rebuilt
 *
 * Deliberate. `marketplaceHref` cannot be called from here — it would need `raw`,
 * `currency` and `currencyInUrl` shipped into the client bundle — and
 * re-deriving the query string by hand would be a *second* URL builder that
 * disagrees with the no-JS path the first time somebody adds a filter and updates
 * only one of them. Reading the form's own `FormData` is precisely what the
 * browser would have submitted, so the two paths are identical by construction
 * rather than by agreement. The hidden inputs are the server's, passed as
 * `children`.
 *
 * ## `requestSubmit`, not `submit`
 *
 * `form.submit()` does not fire the `submit` event, so `onSubmit` would never
 * run and every sort change would be a full page load.
 */
export function SortSelect({
  action,
  value,
  options,
  children,
}: {
  /** The listing's `basePath` — the form's action and the push target. */
  action: string;
  /** The **effective** sort, from the parsed query rather than from `raw`. */
  value: MarketplaceSort;
  options: ReadonlyArray<{ value: MarketplaceSort; label: string }>;
  /** The other filters, as hidden inputs. Built on the server. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={action}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();

        const params = new URLSearchParams();
        for (const [key, entry] of new FormData(event.currentTarget).entries()) {
          if (typeof entry === "string" && entry !== "") params.append(key, entry);
        }

        const query = params.toString();
        // `typedRoutes` cannot know a query string assembled at runtime is valid,
        // and `action` is the caller's own route.
        const href = (query ? `${action}?${query}` : action) as Route;
        startTransition(() => router.push(href));
      }}
      className="flex flex-col gap-2"
    >
      {children}

      <NativeSelect
        name="sort"
        defaultValue={value}
        aria-label="Sort results"
        containerClassName="w-full"
        className="text-[13px]"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>

      {/*
        The no-JavaScript path, and the keyboard one.

        `sr-only focus:not-sr-only` rather than a `<noscript>` block: `<noscript>`
        is hidden whenever scripting is *enabled*, which includes the case where
        it is enabled and hydration failed — exactly when the `onChange` above is
        not there and this button is the only way to apply a sort.
        Hidden-until-focused is reachable in all of those states.
      */}
      <button
        type="submit"
        className="border-border hover:bg-surface-muted sr-only h-8 rounded-lg border text-[12.5px] focus:not-sr-only"
      >
        Apply sort
      </button>

      {/* The keyboard change moves no focus, so the change needs announcing. */}
      <output aria-live="polite" className="sr-only">
        {pending ? "Sorting…" : ""}
      </output>
    </form>
  );
}
