import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrg } from "@/lib/auth/dal";
import { listConversations } from "@/services/messaging/messaging-service";

export const metadata: Metadata = { title: "Messages" };

/**
 * Every thread, in one place — §38.
 *
 * ## It used to be a hardcoded empty state
 *
 * This page performed no query at all: it rendered "No messages" whether the
 * organisation had none or fifty. Meanwhile ticket 21's machinery worked
 * perfectly, reachable only from inside a request. The screen that existed to
 * show messages was the one place they could not be seen.
 *
 * ## An index, not a second inbox
 *
 * Each row links to the subject, because a reply belongs beside the thing it is
 * replying to (§101). Lifting the conversation out of its request is how an
 * answer loses the requirements it was answering about.
 *
 * ## Nothing internal reaches here
 *
 * `listConversations({ audience: "customer" })` applies the same query-level
 * filter as the thread view, so an internal note cannot become a customer's
 * "last message" excerpt or bump their unread count. §37 is a disclosure
 * boundary, and a list view is a new place to breach it.
 */
export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messages"
        description="Every conversation you have with us, newest first."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Inbox />
      </Suspense>
    </div>
  );
}

async function Inbox() {
  const { organizationId, user } = await requireOrg();

  const threads = await listConversations({ organizationId, userId: user.id });

  if (threads.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="No messages yet"
        description="When you send us a request, the conversation about it appears here."
        action={
          <Link
            href="/dashboard/requests"
            className="border-border hover:bg-surface-muted rounded-full border px-4 py-2 text-[13px]"
          >
            Your requests
          </Link>
        }
      />
    );
  }

  return (
    <ul className="border-border divide-border bg-surface divide-y overflow-hidden rounded-xl border">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            href={`/dashboard/requests/${thread.reference}` as Route}
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
