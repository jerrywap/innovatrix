import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/db/enums";

/**
 * The notification categories, and every word we use about them — in one place.
 *
 * ## Why this module exists
 *
 * The same six categories were described in four places, none of which knew
 * about the others: the preferences screen had labels, descriptions and locked
 * reasons; the notification list had a second copy of the labels; the email
 * template had a third, plus a hand-written `isEssential` that duplicated
 * `ESSENTIAL_CATEGORIES` as string literals. All four agreed, and nothing would
 * have noticed if they stopped — the failure mode is a category renamed on the
 * settings screen and still called something else in the email telling you to
 * go and change it.
 *
 * ## Pure on purpose
 *
 * No `server-only`. The preferences screen is a Client Component and the email
 * renderer runs on the server, and both need the same words. Anything needing a
 * database belongs in `services/notifications` instead.
 */

export interface CategoryCopy {
  /** What a person calls it. Note `products` is "Software" to a customer. */
  label: string;
  /** One line, second person, saying what arrives. */
  description: string;
  /** Present when the category cannot be turned off, and says why. */
  locked?: string;
  /** The subject-line prefix. Singular and audience-neutral — see below. */
  subject: string;
}

/**
 * `subject` is separate from `label` and deliberately neutral.
 *
 * A category reaches both audiences, so "Your request" read correctly to the
 * customer and absurdly to the staff member whose queue notice arrived saying
 * it. That was found by reading the probe's subject lines, which is the only
 * way to catch a wording bug.
 */
export const CATEGORY_COPY: Record<NotificationCategory, CategoryCopy> = {
  requests: {
    label: "Requests",
    subject: "Request",
    description: "Updates on the work you've asked us for.",
  },
  quotes: {
    label: "Quotes",
    subject: "Quote",
    description: "When a quote is ready or has changed.",
  },
  billing: {
    label: "Billing",
    subject: "Billing",
    description: "Invoices, payments and receipts.",
    locked: "We have to tell you about money.",
  },
  products: {
    label: "Software",
    subject: "Software",
    description: "New versions of what you own.",
  },
  messages: {
    label: "Messages",
    subject: "Message",
    description: "Replies on your conversations with us.",
  },
  security: {
    label: "Security",
    subject: "Security",
    description: "Sign-ins, password changes and account alerts.",
    locked: "Always on, so you hear if somebody gets in.",
  },
};

/**
 * The categories that ignore preferences entirely.
 *
 * Derived from the copy above rather than listed again: a category is essential
 * **because** it is locked, and keeping one list meant the two could disagree
 * about which. Money and account security are not marketing, and the screen
 * says so on the row itself.
 */
export const ESSENTIAL_CATEGORIES: readonly NotificationCategory[] =
  NOTIFICATION_CATEGORIES.filter((category) => CATEGORY_COPY[category].locked !== undefined);

/** Loose `string` because a stored category is a string until it is validated. */
export function isEssentialCategory(category: string): boolean {
  return (ESSENTIAL_CATEGORIES as readonly string[]).includes(category);
}

/** The subject-line prefix, or `undefined` for a category we do not know. */
export function categorySubject(category: string): string | undefined {
  return category in CATEGORY_COPY
    ? CATEGORY_COPY[category as NotificationCategory].subject
    : undefined;
}

export function categoryLabel(category: string): string {
  return category in CATEGORY_COPY
    ? CATEGORY_COPY[category as NotificationCategory].label
    : category;
}
