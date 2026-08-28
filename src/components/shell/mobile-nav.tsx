"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";
import type { NavSection } from "@/lib/navigation";

/**
 * The sidebar, as a drawer, below `lg`.
 *
 * The same already-filtered `sections` the desktop sidebar gets — one source of
 * truth, so a permission that hides an item on desktop cannot leave it visible
 * on a phone.
 *
 * `SheetTitle` is present and visually hidden rather than omitted: Radix warns
 * without one, and a screen-reader user opening a drawer with no accessible
 * name has no idea what opened.
 */
export function MobileNav({
  sections,
  contextLabel,
  triggerClassName = "lg:hidden",
}: {
  sections: readonly NavSection[];
  contextLabel?: string;
  /**
   * Where the drawer hands over to a horizontal nav.
   *
   * The dashboard's sidebar appears at `lg`, so that is the default. The public
   * header carries four longer labels plus a theme toggle and an account corner,
   * which do not fit on one line until `xl` — and a nav that wraps to two lines
   * is worse than a drawer. A prop rather than two components, because the only
   * thing that differs is the breakpoint.
   */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className={cn(
          "border-border hover:bg-surface-muted grid size-9 place-items-center rounded-lg border transition",
          triggerClassName,
        )}
      >
        <Menu className="size-4" aria-hidden />
      </SheetTrigger>

      <SheetContent side="left" className="w-[280px] p-0">
        <SheetHeader className="px-4 pt-5 pb-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
          {contextLabel && (
            <p className="text-subtle mt-1 font-mono text-[9.5px] tracking-[0.16em] uppercase">
              {contextLabel}
            </p>
          )}
        </SheetHeader>

        <div className="overflow-y-auto px-3.5 py-5">
          {/* Closing on navigation matters: without it, going somewhere leaves
              the drawer open over the page you just asked for. */}
          <SidebarNav sections={sections} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
