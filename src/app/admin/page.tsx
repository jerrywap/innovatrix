import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAnyPermission } from "@/lib/auth/dal";
import { ADMIN_NAV, ADMIN_PERMISSIONS, adminNavFor } from "@/lib/navigation";
import { ShieldAlert } from "lucide-react";
import { navIcon } from "@/components/shell/nav-icons";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Admin" };

/**
 * Admin landing.
 *
 * Deliberately an index rather than a dashboard of metrics. Admin work is
 * errand-shaped — go and change one thing — so the useful thing to show is
 * where those errands live, filtered to what this person may actually do.
 *
 * It renders the *same* filtered sections the sidebar does, from the same
 * function, so the two cannot disagree about what exists.
 */
export default async function AdminPage() {
  const { permissions } = await requireAnyPermission(ADMIN_PERMISSIONS);
  const sections = adminNavFor(permissions);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Admin" description="Catalogue, commerce and platform configuration." />

      {sections.length === 0 ? (
        // Unreachable in practice — the layout's guard requires at least one
        // admin permission — but a screen that renders nothing is worse than
        // one that says why.
        <EmptyState
          icon={ShieldAlert}
          title="Nothing available to you here"
          description="None of your permissions open an admin screen."
        />
      ) : (
        sections.map((section, index) => (
          <section key={section.title ?? index} className="flex flex-col gap-3">
            {section.title && (
              <h2 className="font-display text-[17px] tracking-[-0.02em]">{section.title}</h2>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item) => {
                const Icon = navIcon(item.icon);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="border-border bg-surface hover:border-border-strong flex items-center gap-3 rounded-xl border p-4 transition"
                  >
                    <span className="bg-surface-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="text-[14px] font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}

      {sections.length < ADMIN_NAV.length && (
        <p className="text-subtle text-[12.5px]">
          Some admin areas aren&rsquo;t shown because your roles don&rsquo;t include them.
        </p>
      )}
    </div>
  );
}
