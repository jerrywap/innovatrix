import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { NotificationCategory } from "@/lib/db/enums";
import { Notification, type NotificationDoc } from "@/lib/db/models/communication";
import { formatDateTime } from "@/lib/dates";

/**
 * Reading the notification centre — §69.
 *
 * ## Scoped to the recipient by the query, not by a filter afterwards
 *
 * `recipientUserId` is in the `find`, so there is no shape of this function
 * that returns somebody else's row to filter out later. The same reasoning as
 * ticket 21's message audience: a boundary enforced by the query cannot be
 * undone by a component.
 */

export interface NotificationRow {
  id: string;
  title: string;
  body?: string;
  href?: string;
  category: NotificationCategory;
  /** ISO date. Absolute, never "3 days ago" — it must not flicker on hydration. */
  at: string;
  read: boolean;
}

export interface NotificationPage {
  rows: NotificationRow[];
  unread: number;
}

export async function listNotifications(input: {
  userId: string;
  /** "unread" is the working view; "all" is the record. */
  filter?: "all" | "unread";
  limit?: number;
}): Promise<NotificationPage> {
  await connectToDatabase();

  const recipientUserId = toObjectId(input.userId);
  // §94: bounded, always. A busy account is exactly the one that would return
  // ten thousand rows.
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

  const [rows, unread] = await Promise.all([
    Notification.find({
      recipientUserId,
      ...(input.filter === "unread" ? { readAt: { $exists: false } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<Array<NotificationDoc & { createdAt: Date }>>(),
    Notification.countDocuments({ recipientUserId, readAt: { $exists: false } }),
  ]);

  return {
    unread,
    rows: rows.map((row) => ({
      id: String(row._id),
      title: row.title,
      ...(row.body ? { body: row.body } : {}),
      ...(row.href ? { href: row.href } : {}),
      category: row.category,
      at: formatDateTime(row.createdAt),
      read: Boolean(row.readAt),
    })),
  };
}
