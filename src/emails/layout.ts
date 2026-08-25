import { BRAND, BRAND_LEGAL_IDENTITY } from "@/config/brand";

/**
 * The email shell — one branded layout, rendered to HTML *and* plain text.
 *
 * ## One input, two renderings
 *
 * `src/emails/notification.ts` established the rule this file generalises:
 * plain text is the document and the HTML is a rendering of it, because the
 * usual failure is an HTML template that gains a sentence the text part never
 * got. Here that rule is structural rather than a convention to remember —
 * `composeEmail()` takes one `EmailContent` and returns both parts, so there is
 * no way to add a paragraph to one and not the other.
 *
 * ## Why this is hand-written HTML and not React Email
 *
 * `notification.ts` said the trade would flip "when the second and third
 * templates arrive". It has: there are five. But what flipped is the case for a
 * **shared layout**, not the case for a rendering dependency. Every template
 * here is a heading, some prose, one button and some small print — the shape
 * this file takes as its input. `@react-email/components` would add a package,
 * a render step and a second mental model to produce the same table. When a
 * receipt with line items or a quote with an attachment arrives, that is the
 * template that will not fit `EmailContent`, and that is the moment to revisit.
 *
 * ## The rules email rendering actually imposes
 *
 * Everything below is a workaround for a client, not a style preference:
 *
 * - **Inline styles.** Gmail strips `<head>`, so a stylesheet is decoration
 *   that vanishes. The `<style>` block here carries *only* the dark-mode
 *   overrides, which are the one thing that cannot be inlined — losing them
 *   costs a theme, not a layout.
 * - **Tables, not divs.** Outlook renders with Word's engine. A table with
 *   explicit widths is the one construct it gets right — and `max-width` is one
 *   it ignores entirely, which is what the `<!--[if mso]>` table around the
 *   shell is for. Everywhere else the shell is `width:100%` capped at 560px, so
 *   it fits a phone without needing a media query to rescue it.
 * - **The button is a table cell**, not a padded `<a>`. Word ignores padding on
 *   an inline-block, so a CSS button collapses to bare underlined text there.
 *   A `bgcolor` cell with padding and an anchor filling it needs no VML
 *   conditional and works everywhere.
 * - **No images, including the logo.** Gmail, Outlook and Apple Mail all block
 *   remote images by default until the reader allows them, so an image-based
 *   wordmark is invisible on first read — which is the only read that matters
 *   for a verification link. SVG, which is what `brand-mark.tsx` holds, is
 *   supported by almost nothing. The mark here is therefore typographic, which
 *   suits a brand whose own direction is "paper and ink" anyway.
 * - **The raw URL is printed under every button.** Corporate mail scanners
 *   rewrite links and some clients refuse to open them; without the fallback a
 *   password reset becomes unrecoverable. It is also the honest thing to show
 *   somebody who has been told not to click buttons in email.
 *
 * ## Colour
 *
 * Meridian's tokens, resolved to literals — `globals.css` is a stylesheet the
 * recipient's mail client will never load, and `var()` is unsupported in most
 * of them. These are copies, and the comment at each one names the token it
 * came from so a rebrand can find them.
 *
 * Two measurements worth recording, because both were nearly got wrong:
 *
 * - The footer small print is `--subtle` (#6f6b62), not a lighter grey invented
 *   to look quiet. `--subtle`'s own comment records that #8f8b81 was darkened
 *   because it measured 3.26:1; anything in that family measures about 3.5:1 on
 *   paper and fails AA for 12px text. This value measures **5.1:1**.
 * - The button is white on `--signal`, which measures **3.9:1** — short of AA
 *   for a 15px label. That is not an oversight and it is not fixable here: it is
 *   exactly the app's own primary button (`--primary` / `--primary-foreground`),
 *   and an email whose call to action is a different orange from the product's
 *   is a worse outcome than a shared one. If that brand pair is ever
 *   re-measured, this moves with it rather than ahead of it.
 */

/* ── Meridian, flattened ────────────────────────────────────── */

const INK = "#14130f"; //            --foreground
const INK_SOFT = "#4a463f"; //       between --foreground and --muted-foreground; body prose
const MUTED = "#6b675e"; //          --muted-foreground
const SUBTLE = "#6f6b62"; //         --subtle
const PAPER = "#fbfaf7"; //          --background
const SURFACE = "#ffffff"; //        --surface
const SURFACE_MUTED = "#f3f0e9"; //  --surface-muted
const LINE = "#e6e4df"; //           --border, composited onto paper (it is 10% ink)
const SIGNAL = "#e0521f"; //         --signal, the canonical CoSetup orange
const SIGNAL_CONTRAST = "#ffffff"; //--signal-contrast

/** `--radius` is 1rem; the shell keeps it, the button is a pill as in the app. */
const RADIUS = "16px";

/**
 * Archivo and JetBrains Mono are `next/font` — a webfont a mail client will not
 * fetch. The stacks below are what actually renders, so they are chosen to sit
 * close to the real thing rather than to name it and hope.
 */
const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif,'Apple Color Emoji','Segoe UI Emoji'";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/* ── The content model ──────────────────────────────────────── */

export interface EmailAction {
  label: string;
  url: string;
  /**
   * Whether to print the raw URL under the button. Default **true**.
   *
   * On by default because for three of the five templates the link *is* the
   * message: a verification, a reset and an invitation each carry a
   * time-limited token, and a button that a corporate link-rewriter mangles or
   * a client refuses to open leaves the recipient with nothing to try. The
   * fallback is the difference between an inconvenience and a dead end.
   *
   * Off for a notification, where the URL is an ordinary in-app address with no
   * token in it. Nothing is lost if the button fails — signing in reaches the
   * same page — so the well is weight without a job.
   */
  showUrl?: boolean;
}

export interface EmailContent {
  /**
   * The preview line, shown by the inbox beside the subject.
   *
   * Required rather than optional: left unset, every client invents one from
   * the first words of the body, which for these templates is the greeting. A
   * column of "Hi Jerry," is the difference between a scannable inbox and an
   * unreadable one, and it is free to fix.
   */
  preheader: string;
  /**
   * An optional line *above* the heading — "Hi Jerry,".
   *
   * Only the notification email has one, and it is right that it does: it is
   * the one template addressed to somebody we already know by name, where the
   * others are addressed to an unverified address, a possible stranger, or
   * somebody who may not have asked for the message at all. Greeting the last
   * of those by name would be worse, not warmer.
   */
  greeting?: string;
  heading: string;
  /** Body prose, one entry per paragraph. */
  body: string[];
  action?: EmailAction;
  /**
   * Small print between the button and the footer — expiry, one-time use, "if
   * you didn't ask for this". Quiet in the HTML, but present in both parts.
   */
  notes?: string[];
}

export interface RenderedEmail {
  text: string;
  html: string;
}

/**
 * Render one message into both parts.
 *
 * The text part is assembled first and deliberately reads as a document rather
 * than as a transcript of the HTML: the button becomes its URL on its own line,
 * because a bare URL is what a text-mode reader can act on.
 */
export function composeEmail(content: EmailContent): RenderedEmail {
  return { text: renderText(content), html: renderHtml(content) };
}

function renderText(content: EmailContent): string {
  /*
   * Blocks joined by a blank line, rather than pushing separators as we go.
   * The version that pushed them produced a *double* blank line for a
   * notification with no body — every optional section had to remember not to
   * leave its own separator behind, and one of them didn't. Here an absent
   * section contributes nothing and the spacing cannot drift.
   */
  const blocks: string[] = [];

  if (content.greeting) blocks.push(content.greeting);
  blocks.push(content.heading, ...content.body);

  // The button becomes its URL on its own line: a bare URL is the thing a
  // text-mode reader can actually act on.
  if (content.action) blocks.push(`${content.action.label}:\n${content.action.url}`);
  if (content.notes?.length) blocks.push(...content.notes);

  blocks.push(`— ${BRAND.name}\n${BRAND.url}`, BRAND_LEGAL_IDENTITY);

  return blocks.join("\n\n");
}

function renderHtml(content: EmailContent): string {
  return `<!doctype html>
<html lang="en" style="margin:0;padding:0;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Tells a client that supports it that this design has both themes; without
     it some render the light palette and then invert it themselves. -->
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeText(content.heading)}</title>
<style>
  /* The only rules that cannot be inlined. Gmail's web client drops this block
     entirely, which costs the dark theme and nothing else — every colour below
     has an inline light-mode value that stands on its own. */
  @media (prefers-color-scheme: dark) {
    .cs-paper  { background:#0b0b0c !important; }
    .cs-card   { background:#161615 !important; border-color:#2b2a27 !important; }
    .cs-ink    { color:#f4f1ea !important; }
    .cs-soft   { color:#c9c4b8 !important; }
    .cs-muted  { color:#a19c90 !important; }
    .cs-subtle { color:#8b8579 !important; }
    .cs-rule   { background:#2b2a27 !important; }
    .cs-well   { background:#1e1d1b !important; border-color:#2b2a27 !important; }
    /* The accent re-pairs in the dark theme exactly as globals.css does: a
       brighter orange carrying *dark* text, not white. Keeping the light pair
       here would be both off-brand and the worse of the two — #e0521f with
       white measures 3.9:1, #ff6a3d with #14130f measures 5.7:1. */
    .cs-accent { color:#ff6a3d !important; }
    .cs-brandbg{ background:#ff6a3d !important; }
    .cs-btn    { background:#ff6a3d !important; }
    .cs-btn a  { color:#14130f !important; }
  }
  /* The shell is fluid by construction (width:100% capped by max-width), so
     nothing here has to rescue it — an earlier version pinned it to 560px and
     relied on this block to collapse it, which silently overflowed the phone in
     any client that drops <style>, which is most of them. All this does now is
     buy back a few pixels of gutter, so a URL that has to stay copyable gets
     the room. */
  @media only screen and (max-width:600px) {
    .cs-pad { padding-left:22px !important; padding-right:22px !important; }
  }
</style>
</head>
<body class="cs-paper" style="margin:0;padding:0;width:100%;background:${PAPER};font-family:${SANS};-webkit-font-smoothing:antialiased;">
${preheader(content.preheader)}
<!-- The wrapper carries \`cs-paper\` as well as \`<body>\`. Without it the dark
     override lands on the body, the table paints its own light background
     straight over it, and the result is a dark card floating on a cream page
     with an invisible wordmark. Found by rendering, not by reading. -->
<table role="presentation" class="cs-paper" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
<tr><td class="cs-paper" align="center" style="background:${PAPER};padding:32px 12px 40px;">

<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="cs-shell" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">

  <!-- Wordmark. Type, not an image — see the docblock. -->
  <tr><td class="cs-pad" style="padding:0 28px 18px;">
    <span class="cs-ink" style="font-family:${SANS};font-size:17px;font-weight:700;letter-spacing:-0.02em;color:${INK};">Co<span class="cs-accent" style="color:${SIGNAL};">Setup</span></span>
  </td></tr>

  <tr><td class="cs-card" style="background:${SURFACE};border:1px solid ${LINE};border-radius:${RADIUS};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

      <!-- A 3px rule in the brand colour, flush to the top edge. The one piece
           of ornament, and it survives a client that drops the background. -->
      <tr><td class="cs-brandbg" style="background:${SIGNAL};height:3px;line-height:3px;font-size:0;border-radius:${RADIUS} ${RADIUS} 0 0;">&nbsp;</td></tr>

      ${
        content.greeting
          ? `<tr><td class="cs-pad" style="padding:30px 32px 0;">
        <p class="cs-muted" style="margin:0 0 10px;font-family:${SANS};font-size:14px;line-height:1.5;color:${MUTED};">${escapeText(content.greeting)}</p>
      </td></tr>`
          : ""
      }

      <tr><td class="cs-pad" style="padding:${content.greeting ? "0" : "30px"} 32px 0;">
        <h1 class="cs-ink" style="margin:0;font-family:${SANS};font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.02em;color:${INK};">${escapeText(content.heading)}</h1>
      </td></tr>

      ${content.body
        .map(
          (paragraph) => `<tr><td class="cs-pad" style="padding:14px 32px 0;">
        <p class="cs-soft" style="margin:0;font-family:${SANS};font-size:15px;line-height:1.65;color:${INK_SOFT};">${escapeText(paragraph)}</p>
      </td></tr>`,
        )
        .join("\n      ")}

      ${content.action ? button(content.action) : ""}

      ${content.notes?.length ? notes(content.notes) : ""}

      <tr><td class="cs-pad" style="padding:26px 32px 30px;">
        <div class="cs-rule" style="height:1px;line-height:1px;font-size:0;background:${LINE};">&nbsp;</div>
        <p class="cs-muted" style="margin:16px 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${MUTED};">— ${escapeText(BRAND.name)}</p>
      </td></tr>

    </table>
  </td></tr>

  <tr><td class="cs-pad" style="padding:18px 28px 0;">
    <p class="cs-subtle" style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${SUBTLE};">
      ${escapeText(BRAND_LEGAL_IDENTITY)}<br>
      <a href="${escapeAttribute(BRAND.url)}" style="color:${SUBTLE};text-decoration:underline;">${escapeText(BRAND.domain)}</a>
    </p>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->

</td></tr>
</table>
</body>
</html>`;
}

/**
 * The inbox preview line.
 *
 * Two parts, and both are load-bearing. The hidden span carries the text; the
 * run of zero-width characters after it is what stops the client backfilling
 * the preview with the first words of the body once the span runs out. Kept
 * off-screen by four properties rather than `display:none`, which several
 * clients treat as "skip this content entirely", preview included.
 */
function preheader(text: string): string {
  const filler = "&#847;&zwnj;&nbsp;".repeat(60);
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAPER};opacity:0;">${escapeText(
    text,
  )}${filler}</div>`;
}

/**
 * The call to action, plus the same URL as text.
 *
 * The `<td>` carries the colour and the padding, so Word has a filled box to
 * draw whether or not it honours anything on the anchor. `word-break` on the
 * fallback matters more than it looks: a signed verification token is a single
 * 200-character word, and without it the table is forced wider than the phone.
 */
function button(action: EmailAction): string {
  const href = escapeAttribute(action.url);
  const fallback =
    action.showUrl === false
      ? ""
      : `
      <tr><td class="cs-pad" style="padding:18px 32px 0;">
        <p class="cs-muted" style="margin:0 0 6px;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};">Or paste this into your browser:</p>
        <div class="cs-well" style="background:${SURFACE_MUTED};border:1px solid ${LINE};border-radius:10px;padding:11px 13px;">
          <a href="${href}" class="cs-soft" style="font-family:${MONO};font-size:12px;line-height:1.55;color:${INK_SOFT};text-decoration:none;word-break:break-all;">${escapeText(
            action.url,
          )}</a>
        </div>
      </td></tr>`;

  return `<tr><td class="cs-pad" style="padding:26px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="cs-btn" bgcolor="${SIGNAL}" style="background:${SIGNAL};border-radius:999px;">
            <a href="${href}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:${SIGNAL_CONTRAST};text-decoration:none;border-radius:999px;">${escapeText(
              action.label,
            )}</a>
          </td></tr>
        </table>
      </td></tr>${fallback}`;
}

function notes(lines: string[]): string {
  return `<tr><td class="cs-pad" style="padding:20px 32px 0;">
        ${lines
          .map(
            (line) =>
              `<p class="cs-muted" style="margin:0 0 6px;font-family:${SANS};font-size:12.5px;line-height:1.6;color:${MUTED};">${escapeText(
                line,
              )}</p>`,
          )
          .join("\n        ")}
      </td></tr>`;
}

/**
 * Escaping, in two flavours, because the difference is a real one here.
 *
 * Most of what these templates interpolate is our own copy, but not all of it:
 * an organisation name, an inviter's name and a notification title all come
 * from user input, and the invitation email is delivered to somebody who is not
 * yet a member of anything. `'` is escaped as well as `"` because an attribute
 * quoted either way must survive.
 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A URL in an `href`.
 *
 * Escaped like any other attribute, **and** refused outright unless it is
 * http(s). Every URL these templates carry is built by us from `APP_URL`, so a
 * `javascript:` here would be a bug rather than an attack — but this is the
 * function a later template will reach for with a URL from somewhere else, and
 * the check costs one comparison.
 */
function escapeAttribute(value: string): string {
  const safe = /^https?:\/\//i.test(value) ? value : BRAND.url;
  return escapeText(safe);
}
