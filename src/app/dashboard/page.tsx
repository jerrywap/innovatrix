import type { Metadata, Route } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ClipboardList, FileText, Package, Receipt, ShoppingBag, Store } from "lucide-react";
import { Attention, type AttentionItem } from "@/components/attention";
import { MoneyDisplay } from "@/components/money-display";
import { PageHeader } from "@/components/page-header";
import { StatCard, StatGrid } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money, type CurrencyCode } from "@/lib/money";
import { requireOrg } from "@/lib/auth/dal";
import { attentionItems, dashboardCounts, recentActivity } from "@/features/dashboard/overview";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The customer dashboard — §102.
 *
 * The spec is specific about the shape of this screen, and the ordering below
 * is the whole of it:
 *
 * 1. **What needs you.** Quotes to accept, invoices due, requests waiting on an
 *    answer. Top of the page, above the fold, each one a link to the thing.
 * 2. **What to do next**, for someone with nothing outstanding — the two doors
 *    (§4): buy something that exists, or commission something that doesn't.
 * 3. **Numbers, last.** They are orientation, not the point. A dashboard that
 *    opens with four counters tells a customer how much they have bought, which
 *    is a fact about us, not a task for them.
 *
 * ## Everything below the header is suspended
 *
 * The greeting and the two doors are the same for every visit; the attention
 * list, the counts and the activity feed each hit the database. Splitting them
 * into their own boundaries means a slow count does not hold up the rest of the
 * page, and the shell paints immediately.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { user, organization } = await requireOrg();
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={greeting(user.name)}
        description={
          organization.isPersonal
            ? "Everything you've bought, requested and been quoted."
            : `Working in ${organization.name}.`
        }
      />

      {params.denied === "staff" && (
        // Landed here from /staff or /admin. Saying so beats a silent redirect,
        // which reads as a broken link rather than a closed door.
        <p
          role="status"
          className="border-border bg-surface-muted rounded-xl border px-3.5 py-2.5 text-[13px]"
        >
          That area is for Innovatrix staff. Here&rsquo;s your dashboard instead.
        </p>
      )}

      <Suspense fallback={<Skeleton className="h-32 w-full rounded-xl" />}>
        <NeedsAttention />
      </Suspense>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">Start something</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <DoorCard
            href="/marketplace"
            icon={Store}
            title="Browse the marketplace"
            body="Buy software that already exists, and have it installed."
            cta="Browse products"
          />
          <DoorCard
            href="/custom-software"
            icon={ClipboardList}
            title="Build something custom"
            body="Describe what you need. We'll scope it and send a quote."
            cta="Start a request"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">Your account</h2>
        <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
          <Counts />
        </Suspense>
      </section>

      <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
        <Activity />
      </Suspense>
    </div>
  );
}

/**
 * §27's first question — *what needs my attention*.
 *
 * Above the fold and visually dominant, and empty when there is genuinely
 * nothing: `Attention` renders that as a calm success state rather than a hole,
 * which is §102's "no fabricated urgency" made concrete.
 */
async function NeedsAttention() {
  const { organizationId } = await requireOrg();
  const sources = await attentionItems(organizationId);

  const items: AttentionItem[] = sources.map((source) => ({
    id: source.id,
    title: source.title,
    ...(source.detail ? { detail: source.detail } : {}),
    href: source.href as Route,
    urgent: source.urgent,
    icon: ICONS[source.kind],
    ...(source.amount
      ? {
          meta: (
            <MoneyDisplay
              value={money(source.amount.amount, source.amount.currency as CurrencyCode)}
            />
          ),
        }
      : {}),
  }));

  return <Attention items={items} />;
}

const ICONS = {
  quote_awaiting: FileText,
  invoice_unpaid: Receipt,
  order_awaiting_payment: ShoppingBag,
  update_available: Package,
} as const;

/**
 * Orientation, last — §102.
 *
 * Every figure is an indexed `countDocuments` and reconciles with its list
 * page, because both apply the same filter.
 */
async function Counts() {
  const { organizationId } = await requireOrg();
  const counts = await dashboardCounts(organizationId);

  return (
    <StatGrid>
      <StatCard
        label="Active software"
        value={counts.software}
        icon={Package}
        href="/dashboard/software"
      />
      <StatCard
        label="Orders"
        value={counts.orders}
        icon={ShoppingBag}
        href="/dashboard/orders"
      />
      <StatCard
        label="Quotes awaiting you"
        value={counts.quotes}
        icon={ClipboardList}
        href="/dashboard/quotes"
      />
      <StatCard
        label="Unpaid invoices"
        value={counts.invoices}
        icon={Receipt}
        href="/dashboard/invoices"
      />
    </StatGrid>
  );
}

/** Plain language, customer-visible entries only (§70). */
async function Activity() {
  const { organizationId } = await requireOrg();
  const events = await recentActivity(organizationId);

  if (events.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[17px] tracking-[-0.02em]">Recent activity</h2>
      <ul className="border-border divide-border divide-y rounded-xl border">
        {events.map((event) => (
          <li key={event.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
            <span className="text-[13px]">{event.message}</span>
            <span className="text-subtle shrink-0 font-mono text-[11px]">{event.at}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DoorCard({
  href,
  icon: Icon,
  title,
  body,
  cta,
}: {
  href: React.ComponentProps<typeof Link>["href"];
  icon: typeof Store;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-5">
      <span className="bg-surface-muted text-muted-foreground grid size-9 place-items-center rounded-lg">
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="font-display text-[15.5px] tracking-[-0.02em]">{title}</p>
        <p className="text-muted-foreground mt-1 text-[13.5px]">{body}</p>
      </div>
      <Button asChild variant="outline" className="mt-1 w-fit">
        <Link href={href}>{cta}</Link>
      </Button>
    </div>
  );
}

/**
 * Fixed by UTC hour, not the viewer's clock. A greeting derived from local time
 * differs between server and client and flickers at hydration — a lot of
 * machinery for a word nobody reads twice.
 */
function greeting(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first ? `Welcome back, ${first}` : "Welcome back";
}
