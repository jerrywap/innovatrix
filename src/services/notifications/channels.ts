import "server-only";
import type { NotificationChannel as ChannelKey } from "@/lib/db/enums";
import type { Recipient } from "./recipients";

/**
 * The channel interface — §69.
 *
 * ## The interface is the deliverable; SMS is not
 *
 * §69 names SMS, push and WhatsApp as future channels. What ships now is the
 * shape they will implement, and **only** `in_app` and `email` are registered.
 * A stub that pretends to send is worse than an absent channel: it makes a
 * preferences screen offer something that silently does nothing, and it takes a
 * production incident to discover.
 *
 * ## Delivery is per recipient, not per notification
 *
 * Because the answer to "did it work" differs per person — one address bounces
 * and the rest arrive. A channel reports its own failures and never throws at
 * the dispatcher, which must go on to the next recipient regardless.
 */

export interface DeliveryPayload {
  recipient: Recipient;
  /** The notification row already written, for `in_app` to reference. */
  notificationId: string;
  title: string;
  body?: string;
  /** Absolute, because an email lands outside the app (§69's deep link). */
  url: string;
  /** For the email subject line prefix and the preview text. */
  category: string;
}

export interface NotificationChannelDriver {
  readonly key: ChannelKey;
  /** Resolves when handled. Reports its own failure; never throws. */
  deliver(payload: DeliveryPayload): Promise<void>;
}

const registry = new Map<ChannelKey, NotificationChannelDriver>();

export function registerChannel(driver: NotificationChannelDriver): void {
  registry.set(driver.key, driver);
}

export function channel(key: ChannelKey): NotificationChannelDriver | undefined {
  return registry.get(key);
}

export function registeredChannels(): ChannelKey[] {
  return [...registry.keys()];
}
