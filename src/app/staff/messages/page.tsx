import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { listConversationsForStaff } from "@/services/messaging/messaging-service";

export const metadata: Metadata = { title: "Messages" };

/**
 * Customer threads across every organisation — §30, §38.
 *
 * Like its customer twin, this rendered a hardcoded "No messages" and ran no
 * query. Unlike its twin it reads across organisations, which is what
 * `message.view_all` authorises — the guard below is the whole of that
 * authorisation, since `listConversationsForStaff` applies no org filter.
 *
 * Staff see internal notes in the excerpt, correctly: `audience: "staff"` is
 * baked into that function, and it is the reason it is a separate export rather
 * than a parameter somebody could pass the wrong way round.
 */
export default async function Page() {
  /*
   * Guard first, stream second (AGENTS.md).
   *
   * It was inside `<Inbox>`, under the `<Suspense>` — which flushes the shell
   * before the guard resolves, so `forbidden()` would have rendered the right
   * body under `200 OK`. `loading-boundaries.test.ts` caught it.
   */
  await requirePermissionOrForbid("message.view_all");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messages"
        description="Customer conversations across every request, newest first."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Inbox />
      </Suspense>
    </div>
  );
}

async function Inbox() {
  // Re-read rather than threaded down from the page: `requirePermissionOrForbid`
  // is React-`cache`d, so this is the same session read, not a second one.
  const staff = await requirePermissionOrForbid("message.view_all");

  const threads = await listConversationsForStaff({ userId: staff.user.id });

  if (threads.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="No messages yet"
        description="Customer threads appear here as soon as somebody writes one."
      />
    );
  }

  return (
    <ul className="border-border divide-border bg-surface divide-y overflow-hidden rounded-xl border">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            href={`/staff/requests/${thread.reference}` as Route}
            className="hover:bg-surface-muted flex flex-col gap-1 px-4 py-3.5 transition-colors"
          >
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                {thread.title}
                {thread.unread > 0 && (
                  <span className="bg-signal text-signal-contrast rounded-full px-2 py-0.5 font-mono text-[10px]">
                    {thread.unread}
                  </span>
                )}
              </span>
              <span className="text-subtle shrink-0 text-[12px]">{thread.lastAt}</span>
            </span>
            <span className="text-muted-foreground line-clamp-1 text-[13px]">
              {thread.excerpt}
            </span>
            <span className="text-subtle font-mono text-[10.5px]">{thread.reference}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
