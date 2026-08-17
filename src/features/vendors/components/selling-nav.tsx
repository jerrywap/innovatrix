"use client";

import Link from "next/link";
import type { Route } from "next";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The vendor workspace's sub-navigation.
 *
 * A client island for one reason, the same one as `WizardStepper`:
 * `useSelectedLayoutSegment()`. Next does not re-render a layout on navigation
 * within it, so which item is current cannot be resolved on the server.
 *
 * ## What is not here
 *
 * **Team.** A one-person vendor is the common case and it must not walk through a
 * team model to sell one script, so the team screen is reachable from Settings and
 * advertised nowhere: no nav item, no badge, no empty-state nag. That is a
 * deliberate omission rather than an oversight — see vendor ticket 03.
 *
 * `isOwner` therefore changes nothing here today. It is threaded through because
 * the alternative is the caller learning later that it was needed and adding a
 * second prop drill, and because a `member` reaching Settings should not be shown
 * a link to a screen that will 403 them.
 */
export function SellingNav({ isOwner }: { isOwner: boolean }) {
  const segment = useSelectedLayoutSegment();

  const items: ReadonlyArray<{ label: string; href: Route; segment: string | null }> = [
    { label: "Overview", href: "/dashboard/selling", segment: null },
    { label: "Products", href: "/dashboard/selling/products", segment: "products" },
    { label: "Earnings", href: "/dashboard/selling/earnings", segment: "earnings" },
    { label: "Payouts", href: "/dashboard/selling/payouts", segment: "payouts" },
    { label: "Verification", href: "/dashboard/selling/verification", segment: "verification" },
    ...(isOwner
      ? ([
          { label: "Settings", href: "/dashboard/selling/settings", segment: "settings" },
        ] as const)
      : []),
  ];

  return (
    <nav aria-label="Selling" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const isCurrent = segment === item.segment;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "rounded-lg px-2.5 py-2 text-[13.5px] transition",
              isCurrent
                ? "bg-signal-soft text-signal-text font-medium"
                : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
