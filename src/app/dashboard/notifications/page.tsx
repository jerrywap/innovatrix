import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Bell } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/dal";
import { listNotifications } from "@/features/notifications/notification-view";
import { NotificationList } from "@/features/notifications/components/notification-list";

export const metadata: Metadata = { title: "Notifications" };

export default async function Page({ searchParams }: PageProps<"/dashboard/notifications">) {
  const user = await requireUser();
  const params = await searchParams;
  const unreadOnly = params.filter === "unread";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="What's changed since you were last here."
      />

      <nav className="flex gap-2" aria-label="Filter notifications">
        <Filter href="/dashboard/notifications" label="All" active={!unreadOnly} />
        <Filter
          href="/dashboard/notifications?filter=unread"
          label="Unread"
          active={unreadOnly}
        />
      </nav>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Inbox userId={user.id} unreadOnly={unreadOnly} />
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
        title={unreadOnly ? "Nothing unread" : "You're all caught up"}
        description="We'll tell you here when something needs you or moves forward."
      />
    );
  }

  return <NotificationList rows={page.rows} unread={page.unread} />;
}
