import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireStaffOrRedirect } from "@/lib/auth/dal";
import { findQueue, queueRows, QUEUES } from "@/features/staff/queues";
import { QueueTable } from "@/features/staff/components/queue-table";

export const metadata: Metadata = { title: "Queue" };

/**
 * One work queue — §32.
 *
 * ## Age is the column that matters
 *
 * Not "created", not "updated" — **how long it has been sitting**. A date makes
 * a reader do arithmetic; "9 days" makes the problem obvious at a glance, which
 * is the whole difference between an operational screen and a table.
 *
 * The rows come back oldest-first from the queue definition, so the top of this
 * list is always the thing most at risk.
 */
export async function generateStaticParams() {
  // Not for prerendering — these routes are dynamic. It gives `typedRoutes` the
  // set of valid keys, so a link to a queue that does not exist is a compile
  // error rather than a 404 somebody finds later.
  return QUEUES.map((queue) => ({ key: queue.key }));
}

export default async function Page({ params }: PageProps<"/staff/queue/[key]">) {
  const { key } = await params;
  const { user } = await requireStaffOrRedirect();

  const queue = findQueue(key);
  if (!queue) notFound();

  const rows = await queueRows(queue, user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={queue.label} description={queue.description} />

      <nav className="flex flex-wrap gap-2">
        {QUEUES.map((candidate) => (
          <Link
            key={candidate.key}
            href={`/staff/queue/${candidate.key}` as Route}
            aria-current={candidate.key === queue.key ? "page" : undefined}
            className={
              candidate.key === queue.key
                ? "bg-foreground text-background rounded-full px-3.5 py-1.5 text-[12.5px]"
                : "border-border hover:bg-surface-muted rounded-full border px-3.5 py-1.5 text-[12.5px]"
            }
          >
            {candidate.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing here"
          description="This queue is clear. Try another one from above."
        />
      ) : (
        <QueueTable rows={rows} queueKey={queue.key} />
      )}
    </div>
  );
}
