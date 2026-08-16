"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, type NavSection } from "@/lib/navigation";
import { navIcon } from "./nav-icons";

/**
 * The sidebar's link list.
 *
 * A client island for one reason only: `usePathname()`, to mark the current
 * item. Everything about *which* items exist was decided on the server — this
 * component receives an already-filtered list and has no idea what a permission
 * is. Sending the unfiltered nav plus the rules to the browser would leak the
 * shape of the staff surface to every customer.
 *
 * Icons arrive as **names**, not components. React refuses to pass a component
 * function from a Server Component to a Client one, so `nav-icons.ts` maps the
 * name back to a `LucideIcon` on this side of the boundary. That keeps the nav
 * config serialisable, which is what data crossing a boundary should be.
 */
export function SidebarNav({
  sections,
  onNavigate,
}: {
  sections: readonly NavSection[];
  /** Lets the mobile drawer close itself on navigation. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5" aria-label="Sidebar">
      {sections.map((section, index) => (
        <div key={section.title ?? `section-${index}`} className="flex flex-col gap-1">
          {section.title && (
            <p className="text-subtle px-2.5 pb-1 font-mono text-[9.5px] tracking-[0.16em] uppercase">
              {section.title}
            </p>
          )}

          {section.items.map((item) => {
            const active = isActive(item, pathname);
            const Icon = navIcon(item.icon);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition",
                  active
                    ? "bg-signal-soft text-signal-text"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
