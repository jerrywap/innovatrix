"use client";

import { useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchCurrencyAction } from "@/features/cart/actions";

/**
 * The currency switcher, in the public header.
 *
 * ## It is a Server Action, and it used to be a plain `<a href>`
 *
 * The old mechanism was `?currency=` plus `proxy.ts`, which persists the
 * preference only on a real document navigation because `sec-fetch-dest` is the
 * only thing distinguishing a `<Link>` click from the prefetch Next fires when an
 * href scrolls into view. That constraint is real and still governs the filter
 * rail's currency chips, which stay plain anchors — `proxy.test.ts` holds that
 * line. **It does not apply here any more:** an action runs on submit and is
 * never prefetched, so there is nothing to gate.
 *
 * Two bugs went with it, and neither was visible from this file:
 *
 * 1. The hrefs were built in a *layout* Server Component from the proxy-forwarded
 *    path, and App Router does not re-render a shared layout on a client-side
 *    navigation. So on `/cart`, reached by clicking the basket badge, the menu
 *    still pointed at the page you came from — and switching currency navigated
 *    there. That is COS-33's "it redirects to homepage".
 * 2. The cookie was the only thing written, and `recalculate` prices the basket
 *    from the cart document, so the switch could not re-price a basket at all.
 *
 * `switchCurrencyAction` writes both and calls `revalidatePath`, so the current
 * page re-renders in place with no navigation — and the path it may need comes
 * from `usePathname()`/`useSearchParams()`, which are live across a soft
 * navigation. The full page load the old approach cost is gone with it.
 *
 * `useSearchParams()` is why this component must stay inside a Suspense boundary;
 * `HeaderAccount`'s is the one it is already in.
 *
 * ## `DropdownMenuItem asChild`, not `DropdownMenuRadioItem`
 *
 * A radio item is the semantically ideal fit and **cannot be used here**: this
 * repo's wrapper renders the indicator `<span>` *and* `{children}` inside the
 * primitive, so `asChild` hands Radix's Slot two children and
 * `React.Children.only` throws. Do not "fix" the primitive — `shadcn init`
 * merges in place.
 *
 * So selection is expressed with `aria-current` and a tick we draw ourselves.
 *
 * ## No pre-hydration placeholder, unlike `ThemeToggle`
 *
 * The active currency is known on the server, so the correct label is in the HTML
 * on first paint. Reading the cookie on the client instead would reintroduce
 * exactly the flash that component renders a placeholder to avoid.
 */
export function CurrencyMenu({
  current,
  options,
}: {
  current: string;
  options: ReadonlyArray<{ code: string; symbol: string; name: string }>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const query = searchParams.toString();
  const returnTo = query ? `${pathname}?${query}` : pathname;

  const switchTo = (code: string) => {
    startTransition(async () => {
      await switchCurrencyAction({ currency: code, returnTo });
    });
  };

  return (
    <DropdownMenu>
      {/*
        No `aria-label`. WCAG 2.5.3 wants the accessible name to *contain* the
        visible text — "USD" — so somebody using voice control can say what they
        see. `aria-label="Currency"` would replace it. The `sr-only` span extends
        the name instead, which is the rule AGENTS.md states and `account-menu.tsx`
        works through.
      */}
      <DropdownMenuTrigger className="border-border hover:bg-surface-muted focus-visible:ring-ring flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 font-mono text-[12px] font-medium transition focus-visible:ring-2 focus-visible:outline-none">
        {current}
        <span className="sr-only"> — change currency</span>
        <ChevronDown className="text-subtle size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Show prices in</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {options.map(({ code, symbol, name }) =>
          code === current ? (
            /*
              A `<span>`, not a control. Currency has no "off" state, and
              switching to the one you are in would re-price a basket for no
              reason.

              Deliberately **not** `disabled`: Radix skips disabled items in
              keyboard navigation, so the one row carrying `aria-current` would be
              the one row a keyboard user could never reach.
            */
            <DropdownMenuItem key={code} asChild>
              <span aria-current="true" className="font-medium">
                <span className="font-mono text-[11.5px] text-[var(--signal)]">{code}</span>
                <span className="text-muted-foreground ml-auto text-[12px]">
                  {symbol} {name}
                </span>
                {/* `aria-hidden` — the state is announced by `aria-current`, and a
                    doubly-announced tick is noise. */}
                <Check className="size-3.5 shrink-0 text-[var(--signal)]" aria-hidden />
              </span>
            </DropdownMenuItem>
          ) : (
            /*
              Not `disabled` while the switch is in flight, for the reason the
              active row gives: Radix drops a disabled item out of keyboard
              navigation. The menu closes on select anyway, so there is no second
              click to guard against.
            */
            <DropdownMenuItem
              key={code}
              onSelect={() => switchTo(code)}
              className="cursor-pointer"
            >
              <span className="font-mono text-[11.5px]">{code}</span>
              <span className="text-muted-foreground ml-auto text-[12px]">
                {symbol} {name}
              </span>
              {/* Reserves the tick's column so the rows do not jag. */}
              <span className="size-3.5 shrink-0" aria-hidden />
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
