import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { NotificationCategory, NotificationChannel } from "@/lib/db/enums";
import {
  Notification,
  NotificationPreference,
  mutedKey,
  type NotificationDoc,
} from "@/lib/db/models/communication";
import { serverEnv } from "@/config/env";
import type { DomainEventMap, DomainEventName } from "@/lib/events";
import { rulesFor, type NotificationRule } from "./catalog";
import { resolveAudience, type Recipient } from "./recipients";
import { channel } from "./channels";
import { registerNotificationChannels } from "./drivers";

/**
 * Dispatch — §69.
 *
 * ```
 * domain event → dispatch → resolve recipients
 *                         → write the in-app row (the record)
 *                         → hand it to each enabled channel
 * ```
 *
 * ## The in-app row is written first, and it is the record
 *
 * Email is a copy. If the transport is down the notification still exists, the
 * bell still shows it, and nothing is lost — which is why `emailSentAt` is a
 * field on the row rather than the row being conditional on a send. It also
 * gives ticket 25's retry something to find: rows with no `emailSentAt`.
 *
 * ## Nothing here throws
 *
 * The bus already isolates handlers, but dispatch fans out over many recipients
 * and one bad address must not cost the other nine their notification. Failures
 * are logged per recipient and the loop continues.
 */

/**
 * §69: "transactional essentials are not opt-outable, and the UI says so."
 *
 * `billing` is here because a payment receipt and an invoice notice are not
 * marketing — a customer who muted them would be told nothing about money they
 * owe. `security` because an account alert somebody switched off a year ago is
 * the one they needed.
 *
 * Individual rules can also be marked `essential`, which is how a *category*
 * that is normally optional (a licence key sits under `products`) can still
 * carry something that must arrive.
 */
export const ESSENTIAL_CATEGORIES: readonly NotificationCategory[] = ["billing", "security"];

export interface DispatchResult {
  written: number;
  /** Already delivered — the idempotent path, not a problem. */
  skipped: number;
  /**
   * Recipients whose delivery threw.
   *
   * Reported rather than only logged. Swallowing is right for the *caller* — a
   * notification must not un-do the thing it is about — but a caller with no
   * way to tell that ten sends became zero has to infer it from a log, and a
   * test cannot assert on one at all. This is the number that makes a
   * silently-degraded dispatch visible.
   */
  failed: number;
}

export async function dispatch<K extends DomainEventName>(
  event: K,
  payload: DomainEventMap[K],
  context: Parameters<typeof resolveAudience>[1] = {},
): Promise<DispatchResult> {
  const rules = rulesFor(event);
  if (rules.length === 0) return { written: 0, skipped: 0, failed: 0 };

  /*
   * Here rather than only in `handlers.ts`. Dispatch is also called directly —
   * by a test, and by anything that wants to notify without an event — and a
   * caller who did not know to register the channels first would get in-app
   * rows and silence. Idempotent, so calling it every time costs a boolean.
   */
  registerNotificationChannels();

  await connectToDatabase();

  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, rule] of rules.entries()) {
    const recipients = await resolveAudience(rule.audience, context);

    for (const recipient of recipients) {
      try {
        const delivered = await deliverOne(event, payload, rule, recipient, index);
        if (delivered) written += 1;
        else skipped += 1;
      } catch (error) {
        // One recipient's failure is not the others'. Counted and logged
        // rather than thrown, for the reason at the top of this file.
        failed += 1;
        console.error(
          `[notifications] ${event} → ${recipient.userId} failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return { written, skipped, failed };
}

async function deliverOne<K extends DomainEventName>(
  event: K,
  payload: DomainEventMap[K],
  rule: NotificationRule<K>,
  recipient: Recipient,
  ruleIndex: number,
): Promise<boolean> {
  const href = rule.href(payload);
  const title = rule.title(payload);
  const body = rule.body?.(payload);

  /*
   * The dedupe key.
   *
   * `ruleIndex` is in it because one event can legitimately produce two
   * notifications for the same person — a staff member who is also the
   * assignee gets the queue row and the assignment row, and they say different
   * things. The href is in it because that is what distinguishes the two in
   * practice, and it makes the key readable when somebody is debugging.
   */
  const dedupeKey = `${event}:${ruleIndex}:${href}`;

  /*
   * Resolved *before* the row is written, and stored on it.
   *
   * `channels` records what was **intended**, not what succeeded. That
   * distinction is what makes ticket 25's retry query possible: "an email
   * channel and no `emailSentAt`" only identifies a stranded email if the
   * channel was recorded at the point of deciding. Stamping the channel on
   * success instead — which is what this did before — describes a state that
   * cannot exist, because success also sets `emailSentAt`.
   */
  const channels = await enabledChannels(recipient.userId, rule);

  const row = await insertOnce({
    recipientUserId: recipient.userId,
    ...(recipient.organizationId ? { organizationId: recipient.organizationId } : {}),
    type: event,
    category: rule.category,
    dedupeKey,
    title,
    ...(body ? { body } : {}),
    href,
    channels,
  });

  // Already delivered. A re-emitted event is normal (§87) and the right answer
  // is to do nothing, not to ring the bell twice.
  if (!row) return false;

  for (const key of channels) {
    if (key === "in_app") continue; // The row above *is* the in-app delivery.

    const driver = channel(key);
    if (!driver) continue;

    await driver.deliver({
      recipient,
      notificationId: String(row._id),
      title,
      ...(body ? { body } : {}),
      url: absolute(href),
      category: rule.category,
    });
  }

  return true;
}

/**
 * Insert, or discover that somebody already did.
 *
 * The unique index does the work. A read-then-write would let two concurrent
 * deliveries of the same event both find nothing and both insert — which is
 * exactly the duplicate the criterion forbids, and exactly the race a retry
 * produces.
 */
async function insertOnce(fields: {
  recipientUserId: string;
  organizationId?: string;
  type: string;
  category: NotificationCategory;
  dedupeKey: string;
  title: string;
  body?: string;
  href: string;
  channels: NotificationChannel[];
}): Promise<NotificationDoc | null> {
  try {
    const created = await Notification.create({
      ...fields,
      recipientUserId: toObjectId(fields.recipientUserId),
      ...(fields.organizationId ? { organizationId: toObjectId(fields.organizationId) } : {}),
    });
    return created.toObject() as NotificationDoc;
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * Which channels this person wants, for this category.
 *
 * `in_app` is always on. It is the record rather than a message — switching it
 * off would mean the notification centre lies about what happened, and §69
 * treats the centre as the source of truth that email merely mirrors.
 */
async function enabledChannels(
  userId: string,
  rule: { category: NotificationCategory; essential?: boolean },
): Promise<NotificationChannel[]> {
  if (rule.essential || ESSENTIAL_CATEGORIES.includes(rule.category)) {
    return ["in_app", "email"];
  }

  const preference = await NotificationPreference.findOne({ userId: toObjectId(userId) })
    .select({ muted: 1 })
    .lean<{ muted: string[] }>();

  // Absent means on — see the note on the model. A user who has never touched
  // the screen hears everything.
  const muted = new Set(preference?.muted ?? []);

  return muted.has(mutedKey(rule.category, "email")) ? ["in_app"] : ["in_app", "email"];
}

/** A relative href becomes a link that works from an inbox (§69). */
function absolute(href: string): string {
  return `${serverEnv().APP_URL.replace(/\/$/, "")}${href}`;
}

/* ────────────────────────────────────────────── reads & writes */

export async function unreadCount(userId: string): Promise<number> {
  await connectToDatabase();
  return Notification.countDocuments({
    recipientUserId: toObjectId(userId),
    readAt: { $exists: false },
  });
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  await connectToDatabase();
  await Notification.updateOne(
    // Scoped to the caller. Without it, any id marks anybody's notification
    // read — trivial, but it is somebody else's row.
    { _id: toObjectId(notificationId), recipientUserId: toObjectId(userId) },
    { $set: { readAt: new Date() } },
  );
}

export async function markAllRead(userId: string): Promise<number> {
  await connectToDatabase();
  const result = await Notification.updateMany(
    { recipientUserId: toObjectId(userId), readAt: { $exists: false } },
    { $set: { readAt: new Date() } },
  );
  return result.modifiedCount;
}

export async function setPreference(input: {
  userId: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}): Promise<void> {
  await connectToDatabase();

  if (ESSENTIAL_CATEGORIES.includes(input.category) && !input.enabled) {
    // Refused rather than silently ignored. A screen that appears to accept a
    // switch it will not honour is worse than one that says no.
    throw new Error(`${input.category} notifications cannot be turned off.`);
  }

  const key = mutedKey(input.category, input.channel);

  await NotificationPreference.updateOne(
    { userId: toObjectId(input.userId) },
    input.enabled ? { $pull: { muted: key } } : { $addToSet: { muted: key } },
    { upsert: true },
  );
}

export async function preferencesFor(userId: string): Promise<Set<string>> {
  await connectToDatabase();
  const row = await NotificationPreference.findOne({ userId: toObjectId(userId) })
    .select({ muted: 1 })
    .lean<{ muted: string[] }>();
  return new Set(row?.muted ?? []);
}
