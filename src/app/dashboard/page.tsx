import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Package, ShoppingBag, Store } from "lucide-react";
import { Attention, type AttentionItem } from "@/components/attention";
import { PageHeader } from "@/components/page-header";
import { StatCard, StatGrid } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { requireOrg } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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
 * The attention list is empty until tickets 11, 17 and 22 supply real data; the
 * shape it renders is already the shape those tickets fill in, and `Attention`
 * treats an empty list as a success state rather than a hole.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { user, organization } = await requireOrg();
  const params = await searchParams;

  // Populated by ticket 17 (requests), 22 (quotes) and 23 (invoices). Each of
  // those queries is org-scoped through the repositories, which take their
  // scope from requireOrg() above — never from the request.
  const attention: AttentionItem[] = [];

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

      <Attention items={attention} />

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
        <StatGrid>
          <StatCard
            label="Active software"
            value="—"
            icon={Package}
            href="/dashboard/software"
          />
          <StatCard
            label="Open requests"
            value="—"
            icon={ClipboardList}
            href="/dashboard/requests"
          />
          <StatCard label="Orders" value="—" icon={ShoppingBag} href="/dashboard/orders" />
          <StatCard
            label="Quotes awaiting you"
            value="—"
            icon={ClipboardList}
            href="/dashboard/quotes"
          />
        </StatGrid>
      </section>
    </div>
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
