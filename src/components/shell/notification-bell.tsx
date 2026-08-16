import Link from "next/link";
import type { Route } from "next";
import { Bell } from "lucide-react";
import { unreadCount } from "@/services/notifications/notification-service";

/**
 * The unread badge — §69.
 *
 * ## A Server Component that counts on every render
 *
 * No polling, no subscription. The shell re-renders on navigation and every
 * action that touches a notification revalidates the layout, so the number is
 * right when it matters and never wrong for long. A websocket for a count is
 * infrastructure the MVP does not need — §92's "avoid distributed event
 * infrastructure" applies to the read side too.
 *
 * "Correct across devices" comes from the count being derived rather than
 * stored: there is no per-device state to disagree.
 *
 * ## The number is not the whole accessible name
 *
 * A screen reader hearing "3" beside an unlabelled icon learns nothing. The
 * name says what the three are, and the digits are `aria-hidden` decoration on
 * top of it.
 */
export async function NotificationBell({ userId, href }: { userId: string; href: Route }) {
  const unread = await unreadCount(userId);

  return (
    <Link
      href={href}
      aria-label={unread === 0 ? "Notifications" : `Notifications, ${unread} unread`}
      className="text-muted-foreground hover:text-foreground hover:bg-surface-muted relative rounded-full p-2"
    >
      <Bell className="size-4" aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden
          className="bg-signal text-background absolute -top-0.5 -right-0.5 flex min-w-[16px] items-center justify-center rounded-full px-1 font-mono text-[9.5px] leading-4"
        >
          {/* Past 99 the exact number stops being information and starts being
              a layout problem. */}
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
