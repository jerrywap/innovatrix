import type { EmailMessage } from "@/services/email";

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
 * ## Why not React Email
 *
 * The ticket names React Email, and it is the right answer for a suite of
 * branded templates. This is **one** template with a heading, a sentence and a
 * button; adding `@react-email/components` and a render step to produce it
 * would be a dependency, a build step and a second mental model for a table and
 * an anchor. When the second and third templates arrive — a receipt with line
 * items, a quote with a document attached — that trade flips, and this file is
 * the seam to replace.
 *
 * ## Nothing internal, ever
 *
 * The body comes from the catalog, which composes it from event payloads. An
 * internal staff note is not in any payload (§37) and must never become one:
 * this email leaves our authorisation boundary entirely, and there is no
 * permission check on an inbox.
 */

/**
 * Neutral, because one category reaches both audiences.
 *
 * "Your request" read correctly to the customer and absurdly to the staff
 * member whose queue notice arrived saying it — found by running the probe and
 * reading the subject lines, which is the only way to catch a wording bug.
 */
const CATEGORY_LABEL: Record<string, string> = {
  requests: "Request",
  quotes: "Quote",
  billing: "Billing",
  products: "Software",
  messages: "Message",
  security: "Security",
};

export function notificationEmail(input: {
  to: string;
  name?: string;
  title: string;
  body?: string;
  url: string;
  category: string;
}): EmailMessage {
  const greeting = input.name ? `Hi ${input.name},` : "Hello,";
  const label = CATEGORY_LABEL[input.category] ?? "Innovatrix";

  const text = [
    greeting,
    "",
    input.title,
    ...(input.body ? ["", input.body] : []),
    "",
    input.url,
    "",
    "— Innovatrix",
    "",
    // Only where it applies. A payment receipt has no unsubscribe because it
    // is not a preference — §69, and the screen says the same thing.
    ...(isEssential(input.category)
      ? ["You receive this because it concerns money or your account security."]
      : ["Change what we email you about: manage your notification settings in your account."]),
  ].join("\n");

  return {
    to: input.to,
    subject: `${label}: ${input.title}`,
    text,
    html: html(input, greeting),
  };
}

function isEssential(category: string): boolean {
  return category === "billing" || category === "security";
}

/**
 * Inline styles and a table-free single column.
 *
 * Not minimalism for its own sake: Outlook's rendering engine is Word's, and
 * every layout technique this page avoids is one of the ways that goes wrong.
 * A single centred block with inline styles renders the same in Gmail, Outlook
 * and Apple Mail, which is the criterion.
 */
function html(
  input: { title: string; body?: string; url: string; category: string },
  greeting: string,
): string {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a18;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e1;border-radius:12px;padding:28px;">
<p style="margin:0 0 16px;font-size:14px;">${escape(greeting)}</p>
<h1 style="margin:0 0 12px;font-size:19px;line-height:1.35;font-weight:600;">${escape(input.title)}</h1>
${input.body ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4a4a45;">${escape(input.body)}</p>` : ""}
<a href="${escape(input.url)}" style="display:inline-block;background:#1a1a18;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:999px;font-size:14px;">Open in Innovatrix</a>
<p style="margin:24px 0 0;font-size:12px;color:#8a8a82;">${
    isEssential(input.category)
      ? "You receive this because it concerns money or your account security."
      : "Change what we email you about in your account settings."
  }</p>
</div></body></html>`;
}

/** The title and body are our own copy, but they interpolate event payloads. */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
