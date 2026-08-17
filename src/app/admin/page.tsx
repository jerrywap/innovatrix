import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAnyPermission } from "@/lib/auth/dal";
import { ADMIN_NAV, ADMIN_PERMISSIONS, adminNavFor } from "@/lib/navigation";
import { ShieldAlert } from "lucide-react";
import { navIcon } from "@/components/shell/nav-icons";
import { Skeleton } from "@/components/ui/skeleton";
import { MoneyDisplay } from "@/components/money-display";
import { adminHeadline, asMoney } from "@/features/reporting/headline";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Admin" };

/**
 * Admin landing.
 *
 * ## An index, now with a handful of figures above it
 *
 * The index is still the point: admin work is errand-shaped — go and change one
 * thing — so where those errands live, filtered to what this person may do, is
 * the useful content. It renders the *same* filtered sections the sidebar does,
 * from the same function, so the two cannot disagree about what exists.
 *
 * What it lacked was any answer to "how are we doing", which is the first thing
 * anybody opening an admin area wants. A small strip of headline numbers sits
 * above it now — revenue, orders, catalogue, job health — suspended so the
 * index still renders immediately if the aggregations are slow.
 *
 * Not a reporting screen. Time series, cohorts and per-product breakdowns are
 * named as out of scope in `features/reporting/headline.ts`.
 */
export default async function AdminPage() {
  const { permissions } = await requireAnyPermission(ADMIN_PERMISSIONS);
  const sections = adminNavFor(permissions);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Admin" description="Catalogue, commerce and platform configuration." />

      <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
        <Headline />
      </Suspense>

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

/**
 * Revenue is a **list**, one entry per currency, never one summed number.
 *
 * `money.ts` refuses cross-currency arithmetic and nobody has agreed an FX
 * rate, so adding £70,750 to $51,923 would be a fabrication with a currency
 * symbol on it.
 */
async function Headline() {
  const figures = await adminHeadline();

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="Revenue this month">
        {figures.revenueThisMonth.length === 0 ? (
          <span className="text-subtle text-[13px]">Nothing yet</span>
        ) : (
          <span className="flex flex-wrap items-baseline gap-x-3">
            {figures.revenueThisMonth.map((row) => (
              <MoneyDisplay
                key={row.currency}
                value={asMoney(row)}
                className="text-[18px] font-medium"
              />
            ))}
          </span>
        )}
      </Tile>

      <Tile label="Orders">
        <span className="text-[18px] font-medium">{figures.ordersPaid} paid</span>
        {figures.ordersAwaitingPayment > 0 && (
          <span className="text-subtle text-[12.5px]">
            {figures.ordersAwaitingPayment} awaiting payment
          </span>
        )}
      </Tile>

      <Tile label="Catalogue">
        <span className="text-[18px] font-medium">
          {figures.publishedProducts.toLocaleString("en-GB")} published
        </span>
        {figures.productsInDraft > 0 && (
          <span className="text-subtle text-[12.5px]">{figures.productsInDraft} in draft</span>
        )}
      </Tile>

      {/*
        Vendor ticket 09. Only when there is something waiting — a permanent "0 payouts" tile
        would take a quarter of this strip to say nothing, and the tiles above it earn their
        space by always having a figure.
      */}
      {figures.payoutsAwaiting > 0 && (
        <Tile label="Payouts">
          <Link
            href="/admin/payouts"
            className="text-[18px] font-medium underline underline-offset-4"
          >
            {figures.payoutsAwaiting} waiting
          </Link>
          <span className="text-subtle text-[12.5px]">
            Drafted or failed — nobody has looked
          </span>
        </Tile>
      )}

      <Tile label="Background jobs">
        <span className="text-[18px] font-medium">{figures.jobsQueued} queued</span>
        <span
          className={
            figures.jobsFailed > 0
              ? "text-[12.5px] text-[var(--danger)]"
              : "text-subtle text-[12.5px]"
          }
        >
          {figures.jobsFailed} failed
        </span>
      </Tile>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border bg-surface flex flex-col gap-1 rounded-xl border p-4">
      <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}
