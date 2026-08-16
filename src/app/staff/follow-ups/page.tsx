import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Timer } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireStaffOrRedirect } from "@/lib/auth/dal";
import { countFollowUps, listFollowUps, type FollowUpScope } from "@/features/staff/follow-ups";
import { FollowUpList } from "@/features/staff/components/follow-up-list";

export const metadata: Metadata = { title: "Follow-ups" };

const SCOPES: Array<{ key: FollowUpScope; label: string; description: string }> = [
  { key: "overdue", label: "Overdue", description: "Past their date and still open." },
  { key: "mine", label: "Mine", description: "Open, and yours." },
  { key: "team", label: "Everyone's", description: "Every open follow-up." },
  { key: "done", label: "Closed", description: "Done or no longer needed." },
];

/**
 * §39 — the reminders staff set on customers and requests.
 *
 * **Overdue is the default tab.** A follow-up exists because somebody judged
 * that this would otherwise fall through the cracks; the one that has already
 * fallen through is the one to open the screen on. Landing on "mine" would put
 * a personal list ahead of a problem.
 */
export default async function Page({ searchParams }: PageProps<"/staff/follow-ups">) {
  const { user } = await requireStaffOrRedirect();
  const params = await searchParams;

  const requested = Array.isArray(params.scope) ? params.scope[0] : params.scope;
  const scope: FollowUpScope = SCOPES.some((candidate) => candidate.key === requested)
    ? (requested as FollowUpScope)
    : "overdue";

  const [rows, counts] = await Promise.all([
    listFollowUps(scope, user.id),
    countFollowUps(user.id),
  ]);

  const current = SCOPES.find((candidate) => candidate.key === scope)!;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Follow-ups" description={current.description} />

      <nav className="flex flex-wrap gap-2">
        {SCOPES.map((candidate) => (
          <Link
            key={candidate.key}
            href={`/staff/follow-ups?scope=${candidate.key}` as Route}
            aria-current={candidate.key === scope ? "page" : undefined}
            className={
              candidate.key === scope
                ? "bg-foreground text-background rounded-full px-3.5 py-1.5 text-[12.5px]"
                : candidate.key === "overdue" && counts.overdue > 0
                  ? "rounded-full border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3.5 py-1.5 text-[12.5px]"
                  : "border-border hover:bg-surface-muted rounded-full border px-3.5 py-1.5 text-[12.5px]"
            }
          >
            {candidate.label}
            <span className="text-subtle ml-1.5 font-mono text-[11px]">
              {counts[candidate.key]}
            </span>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={Timer}
          title={scope === "overdue" ? "Nothing overdue" : "Nothing here"}
          description={
            scope === "overdue"
              ? "Everything with a date on it is still in hand."
              : "Set a follow-up from a request or a customer to see it here."
          }
        />
      ) : (
        <FollowUpList rows={rows} />
      )}
    </div>
  );
}
