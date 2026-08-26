import type { EmailMessage } from "@/services/email";
import { BRAND } from "@/config/brand";
import { categorySubject, isEssentialCategory } from "@/lib/notification-categories";
import { composeEmail } from "./layout";

/**
 * The notification email — §69.
 *
 * ## Plain text is the document; the HTML is a rendering of it
 *
 * §69 requires a working plain-text part. Writing the text first and deriving
 * the HTML from the same fields means the two cannot say different things —
 * the usual failure is an HTML template that gains a sentence the text part
 * never got.
 *
 * ## The shell moved out
 *
 * This file used to carry its own `<html>` string. It no longer does: the four
 * auth emails needed the same one, and two hand-written shells is how a brand
 * drifts inside its own codebase. `emails/layout.ts` holds it, along with the
 * argument for why it is still hand-written HTML rather than React Email.
 *
 * What stays here is the part that is genuinely this email's: the category
 * label, the greeting, and which footnote applies.
 *
 * ## Nothing internal, ever
 *
 * The body comes from the catalog, which composes it from event payloads. An
 * internal staff note is not in any payload (§37) and must never become one:
 * this email leaves our authorisation boundary entirely, and there is no
 * permission check on an inbox.
 */

export function notificationEmail(input: {
  to: string;
  name?: string;
  title: string;
  body?: string;
  url: string;
  category: string;
}): EmailMessage {
  const label = categorySubject(input.category) ?? BRAND.name;

  return {
    to: input.to,
    subject: `${label}: ${input.title}`,
    ...composeEmail({
      // The title, not the category. The subject already carries the label, and
      // a preview line that repeats the subject wastes the one line the inbox
      // gives us to say something the subject did not.
      preheader: input.body ?? input.title,
      greeting: input.name ? `Hi ${input.name},` : "Hello,",
      heading: input.title,
      body: input.body ? [input.body] : [],
      action: { label: "Open in CoSetup", url: input.url, showUrl: false },
      notes: [
        isEssentialCategory(input.category)
          ? "You receive this because it concerns money or your account security."
          : "Change what we email you about in your notification settings.",
      ],
    }),
  };
}

/*
 * `isEssentialCategory` was a private copy of the essential list here, agreeing
 * with `ESSENTIAL_CATEGORIES` by coincidence rather than by construction. The
 * footnote it picks is the one telling a reader they can change this in their
 * settings — so a third essential category would have gone on promising a
 * switch that is locked.
 */
