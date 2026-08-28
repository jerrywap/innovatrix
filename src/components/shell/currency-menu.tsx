"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The currency switcher, in the public header.
 *
 * ## Every option is a plain `<a href>`, and that is the whole mechanism
 *
 * The preference is persisted by `proxy.ts`, which can only tell a real
 * navigation from a speculative one by `sec-fetch-dest`. A `<Link>` **click**
 * sends `empty` — byte for byte the same as the prefetch Next fires when an href
 * scrolls into view — so a gate that accepted the click would also accept merely
 * looking at the menu. A document navigation sends `document`, which is
 * unambiguous. The filter rail's currency chips are plain `<a>` for exactly this
 * reason, and `proxy.test.ts` holds the line.
 *
 * Three rules follow, and each one silently breaks the feature:
 *
 * 1. **Never `next/link`.** The failure is nasty rather than obvious: the URL
 *    updates, so the current page renders in the new currency and the control
 *    *looks* like it worked — and the preference is gone on the next navigation.
 * 2. **No `onSelect` + `preventDefault()`, no `router.push`.** `AccountMenu` and
 *    `OrgSwitcher` both do that; copying the idiom here would break it.
 * 3. **No prefetch**, which a plain `<a>` gets by not being a `<Link>`.
 *
 * The cost is one full page load on an action taken about once a session. That is
 * the trade the rail already made and recorded.
 *
 * ## `DropdownMenuItem asChild`, not `DropdownMenuRadioItem`
 *
 * A radio item is the semantically ideal fit and **cannot be used here**: this
 * repo's wrapper renders the indicator `<span>` *and* `{children}` inside the
 * primitive, so `asChild` hands Radix's Slot two children and
 * `React.Children.only` throws. `DropdownMenuItem` renders no children of its
 * own, which is why `AccountMenu` can wrap an anchor with it. Do not "fix" the
 * primitive — `shadcn init` merges in place.
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
  /** Hrefs are precomputed on the server — a function cannot cross the RSC boundary. */
  options: ReadonlyArray<{ code: string; symbol: string; name: string; href: string }>;
}) {
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

        {options.map(({ code, symbol, name, href }) =>
          code === current ? (
            /*
              A `<span>`, not a link — the rail's reasoning. Currency has no "off"
              state, and an href to the currency you are already in is a full page
              load that changes nothing: `proxy.ts` declines it at the
              "different from what is stored" condition, so the control would cost
              a reload and appear to do nothing.

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
            <DropdownMenuItem key={code} asChild>
              <a href={href}>
                <span className="font-mono text-[11.5px]">{code}</span>
                <span className="text-muted-foreground ml-auto text-[12px]">
                  {symbol} {name}
                </span>
                {/* Reserves the tick's column so the rows do not jag. */}
                <span className="size-3.5 shrink-0" aria-hidden />
              </a>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
