"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";
import { ACCOUNT_TABS } from "../tabs";

/**
 * The tab rail — links over sibling routes, not a `Tabs` primitive.
 *
 * A client island for exactly one reason: `useSelectedLayoutSegment()`, so the
 * open tab can be marked. Next does not re-render a layout on navigation within
 * it, so that cannot be resolved on the server. Same trade, and same single
 * reason, as `WizardStepper`.
 *
 * Not `components/ui/tabs`. Radix `Tabs` keeps the active panel in React state,
 * which would mean one route holding four panels: all four tabs' data fetched on
 * every visit, no shareable URL for a tab, and Back doing nothing. Sub-routes
 * give each panel its own guard and its own query for free — and `admin/taxonomies`,
 * the codebase's only `Tabs` screen, is the counter-example rather than the
 * precedent.
 */
export function AccountTabs({ canSeeBilling }: { canSeeBilling: boolean }) {
  const segment = useSelectedLayoutSegment();
  const tabs = ACCOUNT_TABS.filter((tab) => tab.role !== "billing" || canSeeBilling);

  return (
    <nav
      aria-label="Account settings"
      /*
       * Scrolls inside itself on a narrow screen rather than widening the page.
       * Four tabs fit at 390px today; a fifth would not, and a rail that pushes
       * the body sideways is the bug AGENTS.md asks every wide thing to avoid.
       */
      className="border-border -mx-1 flex gap-1 overflow-x-auto border-b px-1"
    >
      {tabs.map((tab) => {
        const active = segment === tab.segment;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13.5px] whitespace-nowrap transition",
              active
                ? "border-signal text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
