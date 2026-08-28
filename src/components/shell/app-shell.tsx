import { Brand } from "./brand";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import type { NavSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * The chrome shared by the three signed-in surfaces (§4).
 *
 * One shell, three tones. The dashboard, the staff console and the admin area
 * are different jobs at different densities, but a customer who becomes a staff
 * member should not have to relearn where things are — so the *structure* is
 * identical and only the accents differ. §107: restrained, not four products
 * wearing one logo.
 *
 * A Server Component. The sidebar it is handed has already been filtered by the
 * DAL, so nothing about permissions crosses to the browser. `SidebarNav` and
 * `MobileNav` are the only client parts, and both exist purely to know which
 * link is current.
 */

export interface AppShellProps {
  sections: readonly NavSection[];
  /** Top-left, links home for this surface. */
  /** Small label under the wordmark: "Staff", "Admin", the organization name. */
  contextLabel?: string;
  /** Right side of the top bar — org switcher, account menu, actions. */
  topBarEnd?: React.ReactNode;
  /** Full-width strip under the top bar. Verification banners live here. */
  banner?: React.ReactNode;
  children: React.ReactNode;
  /** Staff and admin run denser and wider than a customer dashboard. */
  density?: "comfortable" | "dense";
}

export function AppShell({
  sections,
  contextLabel,
  topBarEnd,
  banner,
  children,
  density = "comfortable",
}: AppShellProps) {
  return (
    <div className="flex min-h-full flex-1">
      {/* Desktop sidebar. `sticky` rather than `fixed` so it participates in
          the flex row and never overlaps content at narrow widths. */}
      <aside className="border-border bg-sidebar sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-6 overflow-y-auto border-r px-3.5 py-5 lg:flex">
        <div className="px-2.5">
          <Brand />
          {contextLabel && (
            <p className="text-subtle mt-1.5 font-mono text-[9.5px] tracking-[0.16em] uppercase">
              {contextLabel}
            </p>
          )}
        </div>

        <SidebarNav sections={sections} />

        <div className="mt-auto px-2.5">
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background/80 sticky top-0 z-40 border-b backdrop-blur-xl">
          <div
            className={cn(
              "flex items-center justify-between gap-4 px-4 py-3",
              density === "comfortable" ? "lg:px-8" : "lg:px-6",
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <MobileNav sections={sections} {...(contextLabel ? { contextLabel } : {})} />
              <div className="lg:hidden">
                <Brand compact />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">{topBarEnd}</div>
          </div>
          {banner}
        </header>

        <main
          className={cn(
            "flex-1 px-4 py-6",
            density === "comfortable"
              ? "mx-auto w-full max-w-[1180px] lg:px-8 lg:py-8"
              : "w-full lg:px-6",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
