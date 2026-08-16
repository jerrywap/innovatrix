import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Bell } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaffOrRedirect } from "@/lib/auth/dal";
import { listNotifications } from "@/features/notifications/notification-view";
import { NotificationList } from "@/features/notifications/components/notification-list";

export const metadata: Metadata = { title: "Notifications" };

/**
 * The staff inbox — the same rows, the same component.
 *
 * There is no separate staff notification store: a notification belongs to a
 * *person*, and a staff member who is also a customer of ours would otherwise
 * have two inboxes and no way to know which one to check. The hrefs differ per
 * audience (that is the catalog's job), the container does not.
 */
export default async function Page({ searchParams }: PageProps<"/staff/notifications">) {
  // No specific permission: everybody who works here has an inbox. Being staff
  // is the whole requirement, and the query is scoped to the person.
  const staff = await requireStaffOrRedirect();
  const params = await searchParams;
  const unreadOnly = params.filter === "unread";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Notifications" description="What's landed on your desk." />

      <nav className="flex gap-2" aria-label="Filter notifications">
        <Filter href="/staff/notifications" label="All" active={!unreadOnly} />
        <Filter href="/staff/notifications?filter=unread" label="Unread" active={unreadOnly} />
      </nav>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Inbox userId={staff.user.id} unreadOnly={unreadOnly} />
      </Suspense>
    </div>
  );
}

function Filter({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "bg-foreground text-background rounded-full px-3 py-1 text-[12.5px]"
          : "border-border hover:bg-surface-muted rounded-full border px-3 py-1 text-[12.5px]"
      }
    >
      {label}
    </Link>
  );
}

async function Inbox({ userId, unreadOnly }: { userId: string; unreadOnly: boolean }) {
  const page = await listNotifications({
    userId,
    filter: unreadOnly ? "unread" : "all",
  });

  if (page.rows.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title={unreadOnly ? "Nothing unread" : "Nothing waiting"}
        description="New work, assignments and customer replies land here."
      />
    );
  }

  return <NotificationList rows={page.rows} unread={page.unread} />;
}
