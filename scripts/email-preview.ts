import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  invitationMessage,
  resetPasswordMessage,
  vendorInvitationMessage,
  verifyEmailMessage,
  type EmailMessage,
} from "@/services/email";
import { notificationEmail } from "@/emails/notification";
import { composeEmail } from "@/emails/layout";
import { CATALOG } from "@/services/notifications/catalog";

/**
 * Render every template to `.dev-emails/preview/` — `npm run email:preview`.
 *
 * ## Why a script and not a test
 *
 * There is no assertion that would have caught the thing this exists to catch.
 * An email is wrong when it renders wrong, and the only instruments for that
 * are a browser and — for Outlook specifically — sending one. A snapshot test
 * over the HTML would go red on every wording change and stay green through a
 * layout that collapses in Word.
 *
 * So this produces artefacts to look at: one `.html` per template plus a
 * `.txt`, and an `index.html` that frames them all at phone and desktop widths.
 * Reviewing the set side by side is also what catches the failure a single
 * template cannot show — two emails that have drifted apart.
 *
 * ## The fixtures are deliberately awkward
 *
 * A name with an apostrophe, an organisation with an ampersand and a
 * 200-character signed token are the three inputs that have actually broken
 * this kind of template: the first two by escaping, the third by forcing the
 * table wider than the viewport.
 */

const OUT_DIR = join(process.cwd(), ".dev-emails", "preview");

const TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImphbmVAZXhhbXBsZS5jb20iLCJpYXQiOjE3ODc2MjMwODgsImV4cCI6MTc4NzYyNjY4OH0.MxoATazQtWykH9xOH42I68tUivcc5_v5iDp2As5rq58";

const BASE = process.env.APP_URL ?? "https://cosetup.net";

function written<K extends keyof typeof CATALOG>(
  event: K,
  ruleIndex: number,
  payload: never,
  path: string,
): EmailMessage {
  const rule = (CATALOG[event] ?? [])[ruleIndex];
  if (!rule?.email) throw new Error(`${String(event)}[${ruleIndex}] has no written email`);

  const { subject, ...content } = rule.email(payload, { url: `${BASE}${path}` });
  return { to: "jane@example.com", subject, ...composeEmail(content) };
}

const APPLIED = {
  vendorId: "6a8d098b620e81d85c6a3e4b",
  displayName: "Olamighty",
  country: "NG",
} as never;

const DECIDED = (outcome: "approved" | "rejected", level: "identity" | "business") =>
  ({
    vendorId: "6a8d098b620e81d85c6a3e4b",
    displayName: "Olamighty",
    level,
    outcome,
    ...(outcome === "rejected"
      ? {
          note: "The photo page of the passport is cut off at the bottom — we need the two machine-readable lines along the very bottom edge. A photo taken flat on a table usually does it.",
        }
      : {}),
  }) as never;

const SAMPLES: Array<{ slug: string; label: string; message: EmailMessage }> = [
  {
    slug: "verify-email",
    label: "Confirm your email address",
    message: verifyEmailMessage(
      "jane@example.com",
      `${BASE}/api/auth/verify-email?token=${TOKEN}&callbackURL=%2Fdashboard`,
    ),
  },
  {
    slug: "reset-password",
    label: "Reset your password",
    message: resetPasswordMessage("jane@example.com", `${BASE}/reset-password?token=${TOKEN}`),
  },
  {
    slug: "invitation",
    label: "Organisation invitation",
    message: invitationMessage({
      to: "jane@example.com",
      organizationName: "Brightpath Health & Care",
      inviterName: "Amara O'Brien",
      url: `${BASE}/accept-invite?id=6a8cf6b172bbfac347795106`,
    }),
  },
  {
    slug: "vendor-invitation",
    label: "Vendor team invitation",
    message: vendorInvitationMessage({
      to: "jane@example.com",
      vendorName: "Northwind & Co",
      inviterName: "Amara O'Brien",
      role: "owner",
      url: `${BASE}/accept-invite?id=6a8cf6b172bbfac347795107`,
    }),
  },
  {
    slug: "vendor-applied",
    label: "Vendor application received",
    message: written("VendorApplied", 1, APPLIED, "/dashboard/selling/verification"),
  },
  {
    slug: "vendor-applied-staff",
    label: "Vendor application received — staff copy",
    message: written("VendorApplied", 0, APPLIED, "/staff/vendor-applications"),
  },
  {
    slug: "verification-approved",
    label: "Verification level approved",
    message: written(
      "VendorVerificationDecided",
      0,
      DECIDED("approved", "identity"),
      "/dashboard/selling/verification",
    ),
  },
  {
    slug: "verification-rejected",
    label: "Verification level rejected",
    message: written(
      "VendorVerificationDecided",
      0,
      DECIDED("rejected", "identity"),
      "/dashboard/selling/verification",
    ),
  },
  /*
   * The account-security alerts. Four events, one writer, so previewing two
   * covers the shape and the two wordings that differ most — a change with no
   * detail beyond itself, and one naming a provider.
   */
  {
    slug: "security-password-changed",
    label: "Security — password changed",
    message: written("PasswordChanged", 0, undefined as never, "/dashboard/account/security"),
  },
  {
    slug: "security-google-disconnected",
    label: "Security — Google disconnected",
    message: written(
      "SocialAccountUnlinked",
      0,
      { userId: "6a8cf6b072bbfac3477950f8", provider: "google" } as never,
      "/dashboard/account/security",
    ),
  },
  {
    slug: "notification-billing",
    label: "Notification — billing (essential)",
    message: notificationEmail({
      to: "jane@example.com",
      name: "Jane",
      title: "Payment received for ORD-2026-0148",
      body: "We've received £1,240.00 and your licences are active. The receipt is on the order.",
      url: `${BASE}/dashboard/orders/ORD-2026-0148`,
      category: "billing",
    }),
  },
  {
    slug: "notification-requests",
    label: "Notification — requests (preference)",
    message: notificationEmail({
      to: "jane@example.com",
      title: "Your request has a new quote",
      url: `${BASE}/dashboard/requests/REQ-2026-0031`,
      category: "requests",
    }),
  },
];

/**
 * A catalog rule that writes its own email, rendered through the same shell.
 *
 * Pulled from `CATALOG` rather than duplicated here, so the preview cannot drift
 * from what actually gets sent — which is the failure a preview exists to avoid.
 */

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  for (const sample of SAMPLES) {
    const { message } = sample;
    if (!message.html) throw new Error(`${sample.slug} rendered no HTML part`);
    await writeFile(join(OUT_DIR, `${sample.slug}.html`), message.html, "utf8");
    await writeFile(
      join(OUT_DIR, `${sample.slug}.txt`),
      `Subject: ${message.subject}\n\n${message.text}\n`,
      "utf8",
    );
  }

  await writeFile(join(OUT_DIR, "index.html"), indexPage(), "utf8");

  console.info(`\n  ${SAMPLES.length} templates → ${OUT_DIR}`);
  console.info(`  open ${join(OUT_DIR, "index.html")}\n`);
  for (const sample of SAMPLES) {
    console.info(`  ${sample.slug.padEnd(24)} ${sample.message.subject}`);
  }
  console.info("");
}

/** Each template at 375px and 640px, so the mobile break is visible at a glance. */
function indexPage(): string {
  const frames = SAMPLES.map(
    (sample) => `<section>
  <h2>${sample.label}</h2>
  <p><code>${sample.message.subject}</code> · <a href="${sample.slug}.txt">text part</a></p>
  <div class="row">
    <div><span>375px</span><iframe src="${sample.slug}.html" width="375" height="720"></iframe></div>
    <div><span>640px</span><iframe src="${sample.slug}.html" width="640" height="720"></iframe></div>
  </div>
</section>`,
  ).join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CoSetup email templates</title>
<style>
  body{margin:0;padding:28px;background:#e9e7e1;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#14130f}
  h1{font-size:20px;margin:0 0 4px}
  h2{font-size:15px;margin:0 0 4px}
  p{margin:0 0 10px;color:#6b675e;font-size:12.5px}
  code{font-family:ui-monospace,Menlo,monospace}
  section{margin:0 0 34px}
  .row{display:flex;gap:16px;flex-wrap:wrap}
  .row span{display:block;font-size:11px;color:#8b8579;margin-bottom:4px}
  iframe{border:1px solid #cfccc4;border-radius:8px;background:#fff}
</style></head>
<body>
<h1>CoSetup email templates</h1>
<p>Rendered by <code>npm run email:preview</code>. Toggle your OS theme to check the dark palette — the light one is inline, the dark one is a media query.</p>
${frames}
</body></html>`;
}

main().catch((error) => {
  console.error("\nemail preview failed:", error);
  process.exit(1);
});
