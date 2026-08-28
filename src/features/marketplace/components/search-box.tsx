"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import type { Route } from "next";

/**
 * The search input — §74.
 *
 * ## Two modes, because two pages want opposite things
 *
 * - **`filter`** (the marketplace) narrows the page you are already on. Every
 *   pause in typing replaces the URL, and results re-render underneath.
 * - **`navigate`** (the landing hero) takes you somewhere else. It fires on
 *   submit only and pushes, so Back returns to where you started.
 *
 * The distinction is not cosmetic. A debounced navigate would carry the visitor
 * off the home page mid-word.
 *
 * ## The target is `basePath`, never `usePathname()`
 *
 * It used to be the latter, which was a latent bug: `basePath` drove only the
 * no-JS `<form action>`, so once hydrated the component always filtered the
 * *current* URL. Harmless while the single caller passed its own pathname, and
 * wrong the moment a second caller wanted to search from somewhere else — the
 * hero would have pushed `/?q=…`, a home page with a query string and no
 * results. One prop now decides both halves, so they cannot disagree.
 *
 * ## Debounced in `filter` mode, and the debounce is the point
 *
 * Free-text queries are **not cached** — `q` is attacker-controlled, so caching
 * on it makes the key space unbounded. That means every keystroke that reaches
 * the server is a full `$text` aggregation. 350ms is long enough that "invoice"
 * is one query rather than seven, and short enough that it still feels live.
 *
 * ## It degrades to a plain form
 *
 * The `<form>` has a real `action`, so before hydration — or with JavaScript
 * off — pressing Enter still searches. The router push is an enhancement on top
 * of something that already works.
 */
export interface SearchBoxProps {
  /** Where a search goes. Both the `<form action>` and the router target. */
  basePath: string;
  /** `filter` narrows the current page; `navigate` goes to `basePath`. */
  mode?: "filter" | "navigate";
  /** Unique per instance — two boxes on one page must not share a label. */
  inputId?: string;
  placeholder?: string;
  /** The accessible name, when "Search the marketplace" is not what this does. */
  label?: string;
  /**
   * Names the `<form>`, so a submit button rendered *outside* it can drive it.
   *
   * `<button type="submit" form="…">` is the platform's own answer to a control
   * that belongs to a form it does not sit inside — which is what the hero's
   * split button is, since it lives beside the box rather than within it. It
   * submits natively with JavaScript off, so the no-JS path the `<form action>`
   * already guarantees survives the button too.
   */
  formId?: string;
}

export function SearchBox(props: SearchBoxProps) {
  const searchParams = useSearchParams();
  // Remount when the URL's `q` changes, which resets the uncontrolled input to
  // whatever the URL now says. The obvious alternative — a `useEffect` that
  // calls `setValue` when `searchParams` changes — is a cascading render: the
  // effect runs after paint, sets state, and forces a second render of a
  // component that is already correct. React's `set-state-in-effect` rule flags
  // it, and it is right to.
  return <SearchField key={searchParams.get("q") ?? ""} {...props} />;
}

function SearchField({
  basePath,
  mode = "filter",
  inputId = "marketplace-search",
  placeholder = "Search by name, what it does, or the stack…",
  label = "Search the marketplace",
  formId,
}: SearchBoxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const push = (next: string) => {
    // In `navigate` mode the destination is a different page, so the current
    // page's filters are not ours to carry over.
    const params = new URLSearchParams(mode === "filter" ? searchParams.toString() : "");
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    // A new query is a new result set, so page 1.
    params.delete("page");

    const query = params.toString();
    const href = (query ? `${basePath}?${query}` : basePath) as Route;

    startTransition(() => {
      // `typedRoutes` cannot know a runtime-built query string is valid, and
      // `basePath` is supplied by the caller as a real route.
      if (mode === "navigate") router.push(href);
      else router.replace(href, { scroll: false });
    });
  };

  const onChange = (next: string) => {
    setValue(next);
    if (mode !== "filter") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => push(next), 350);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <form
      {...(formId ? { id: formId } : {})}
      action={basePath}
      method="get"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        clearTimeout(timer.current);
        push(value);
      }}
      className="relative"
    >
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>

      <Search
        className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden
      />

      <input
        id={inputId}
        name="q"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={120}
        autoComplete="off"
        className="border-border bg-surface focus-visible:ring-ring h-11 w-full rounded-xl border pr-10 pl-9 text-[14px] focus-visible:ring-2 focus-visible:outline-none"
      />

      {pending ? (
        <Loader2
          className="text-subtle absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
          aria-hidden
        />
      ) : (
        value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              clearTimeout(timer.current);
              if (mode === "filter") push("");
            }}
            className="text-subtle hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-1"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Clear the search</span>
          </button>
        )
      )}

      <output aria-live="polite" className="sr-only">
        {pending ? "Searching…" : ""}
      </output>
    </form>
  );
}
