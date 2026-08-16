import type { Metadata } from "next";
import { ClipboardList, FileText, MessagesSquare, Timer } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard, StatGrid } from "@/components/stat-card";
import { requireStaff } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Queues" };

/**
 * The staff landing screen — §77.
 *
 * Queues, not a dashboard. The counters here are the opposite case to §102's
 * warning about decorative statistics: for someone whose job *is* the queue,
 * the number waiting is the information, and every card goes straight to the
 * list it counts.
 *
 * Each card is gated by the same permission as the screen behind it, so a
 * `finance` user doesn't see a request count they cannot open. The counts
 * arrive with tickets 17, 19 and 22.
 */
export default async function StaffQueuesPage() {
  const { user, permissions } = await requireStaff();

  const canSeeRequests = permissions.has("request.view_all");
  const canSeeQuotes = permissions.has("quote.view_all");
  const canSeeMessages = permissions.has("message.view_all");
  const nothingAssigned = !canSeeRequests && !canSeeQuotes && !canSeeMessages;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Queues"
        description={`What's waiting, ${user.name.split(" ")[0] ?? "there"}.`}
      />

      {nothingAssigned ? (
        <EmptyState
          icon={ClipboardList}
          title="No queues for your roles"
          description="Your permissions don't open any of the shared queues. That's expected for some roles — use the sidebar for the areas you do have."
        />
      ) : (
        <StatGrid>
          {canSeeRequests && (
            <StatCard
              label="Unassigned requests"
              value="—"
              icon={ClipboardList}
              href="/staff/requests"
              tone="signal"
              hint="Waiting for triage"
            />
          )}
          {canSeeRequests && (
            <StatCard
              label="Follow-ups due"
              value="—"
              icon={Timer}
              href="/staff/follow-ups"
              hint="Owed to a customer"
            />
          )}
          {canSeeQuotes && (
            <StatCard label="Draft quotes" value="—" icon={FileText} href="/staff/quotes" />
          )}
          {canSeeMessages && (
            <StatCard
              label="Awaiting reply"
              value="—"
              icon={MessagesSquare}
              href="/staff/messages"
            />
          )}
        </StatGrid>
      )}
    </div>
  );
}
