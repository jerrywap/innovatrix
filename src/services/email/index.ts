import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTransport } from "nodemailer";
import { serverEnv } from "@/config/env";

/**
 * Transactional email — the port, plus a development implementation.
 *
 * Ticket 24 swaps in Resend behind `EmailTransport` without touching any
 * caller. Everything before then needs verification and reset links to be
 * *reachable*, not delivered, so the dev transport prints them to the terminal
 * and writes an .eml-ish file to `.dev-emails/` (gitignored).
 *
 * Two rules that hold for every transport, present and future:
 *
 * 1. **Sending must never break the flow that triggered it.** A password reset
 *    that 500s because the mail provider is down leaves the user with no
 *    recourse and no reset. Failures are logged and swallowed; the exception is
 *    development, where a silent failure would hide the link you need.
 *
 * 2. **The link is the secret.** Tokens are not logged separately, not stored
 *    anywhere else, and the dev files live outside version control.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text is the source of truth here; ticket 24 adds React templates. */
  text: string;
  html?: string;
  /** For the terminal banner — makes a reset link obvious in a busy log. */
  kind?: AuthEmailKind;
}

export type AuthEmailKind = "verify-email" | "reset-password" | "organization-invitation";

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/* ────────────────────────────────────────────── dev transport */

const DEV_EMAIL_DIR = ".dev-emails";

/** Filesystem-safe, and sorts chronologically in a directory listing. */
function devFilename(message: EmailMessage): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const recipient = message.to.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${stamp}__${message.kind ?? "email"}__${recipient}.txt`;
}

const consoleAndFileTransport: EmailTransport = {
  name: "dev-console",
  async send(message) {
    // The link is the only part anyone needs in development. Surfacing it on
    // its own line means it can be clicked straight out of the terminal.
    const links = message.text.match(/https?:\/\/\S+/g) ?? [];

    const banner = [
      "",
      "┌─────────────────────────────────────────────────────────────",
      `│ ✉  ${message.subject}`,
      `│    to: ${message.to}`,
      ...links.map((link) => `│    ${link}`),
      "└─────────────────────────────────────────────────────────────",
      "",
    ].join("\n");
    console.info(banner);

    try {
      const dir = join(process.cwd(), DEV_EMAIL_DIR);
      await mkdir(dir, { recursive: true });
      const body = [
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        `Kind: ${message.kind ?? "email"}`,
        `Date: ${new Date().toISOString()}`,
        "",
        message.text,
      ].join("\n");
      await writeFile(join(dir, devFilename(message)), body, "utf8");
    } catch (error) {
      // Deliberately loud in dev: a missing file here means the link is only in
      // the scrollback, which is exactly when you'll want it and not have it.
      console.warn(`[email] could not write to ${DEV_EMAIL_DIR}/`, error);
    }
  },
};

/* ────────────────────────────────────────────── smtp transport */

/**
 * Real delivery, over SMTP.
 *
 * ## It throws, and that is the contract
 *
 * `handlers/email.ts` does not catch: the job runner decides a send failed by
 * watching for a rejection, and retries five times with backoff. A transport
 * that swallowed its own errors would report success to the queue, stamp
 * `emailSentAt`, and quietly deliver nothing.
 *
 * Note the other caller has the opposite contract — `sendAuthEmail` catches,
 * because a verification email failing must not take down sign-up. Two callers,
 * two policies, and both are satisfied by a transport that simply tells the
 * truth.
 *
 * ## The transporter is pooled and built once
 *
 * `resolveTransport()` is memoised, so this closure is created once per process
 * and nodemailer keeps the connection pool. Building one per send would mean a
 * TLS handshake per email.
 *
 * ## `secure` comes from the port
 *
 * 465 is implicit TLS; anything else negotiates STARTTLS. Deriving it removes
 * the configuration that can contradict itself.
 */
function smtpTransport(): EmailTransport {
  const env = serverEnv();
  const host = env.SMTP_HOST!;
  const port = env.SMTP_PORT ?? 587;

  const mailer = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: env.SMTP_USERNAME!, pass: env.SMTP_PASSWORD! },
    pool: true,
  });

  return {
    name: `smtp:${host}`,
    async send(message) {
      await mailer.sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    },
  };
}

/* ────────────────────────────────────────────── selection */

let transport: EmailTransport | undefined;

/**
 * Which transport should run, from the environment.
 *
 * Pure and exported so it can be tested without a mailer: the decision is the
 * part that goes wrong, and it goes wrong silently.
 *
 * `EMAIL_TRANSPORT` wins when set. Unset, it derives — SMTP if a host is
 * configured, otherwise log — so an existing `.env.local` keeps its meaning.
 *
 * ## Why the override exists
 *
 * Every seeded account is on `.test`, an IANA-reserved TLD that will never
 * resolve. So with SMTP configured, a password reset for
 * `super@innovatrix.test` is handed to a real mail server, bounces, and the
 * link is nowhere — `sendAuthEmail` swallows the failure outside development,
 * and the queue retries five times against an address that cannot exist.
 *
 * `EMAIL_TRANSPORT=log` is how a developer with working SMTP credentials still
 * reads their own reset links.
 */
export function chooseTransportKind(env: {
  EMAIL_TRANSPORT?: "log" | "smtp";
  SMTP_HOST?: string;
}): "log" | "smtp" {
  if (env.EMAIL_TRANSPORT) return env.EMAIL_TRANSPORT;
  return env.SMTP_HOST ? "smtp" : "log";
}

/**
 * The transport itself, built once — `emailTransport()` memoises this.
 *
 * The default when nothing is configured is the log transport, deliberately:
 * `.dev-emails/` is how ticket 29 §G is read, and nobody should start sending
 * real mail from a laptop because they forgot to unset a variable.
 */
function resolveTransport(): EmailTransport {
  const env = serverEnv();
  const kind = chooseTransportKind(env);

  // Said once per process, because "why did that email not arrive" is otherwise
  // a twenty-minute question with a one-word answer.
  console.info(`[email] transport: ${kind}${kind === "log" ? " (.dev-emails/)" : ""}`);

  return kind === "smtp" ? smtpTransport() : consoleAndFileTransport;
}

export function emailTransport(): EmailTransport {
  return (transport ??= resolveTransport());
}

/** Tests only. */
export function setEmailTransport(next: EmailTransport | undefined): void {
  transport = next;
}

/**
 * Send an authentication email. Never throws in production — see rule 1 above.
 */
export async function sendAuthEmail(message: EmailMessage): Promise<void> {
  const env = serverEnv();
  try {
    await emailTransport().send(message);
  } catch (error) {
    console.error(`[email] failed to send "${message.subject}" to ${message.to}`, error);
    if (env.NODE_ENV === "development") throw error;
  }
}

/* ────────────────────────────────────────────── templates

   Plain-text only for now. Ticket 24 replaces these with real templates; the
   wording here is already the wording we mean, so that swap is presentational.

   Note none of them state whether an account exists — §88's "generic messages
   that don't disclose whether an email exists" applies to email bodies too,
   not only to the form response.                                            */

export function verifyEmailMessage(to: string, url: string): EmailMessage {
  return {
    to,
    kind: "verify-email",
    subject: "Confirm your email address",
    text: [
      "Welcome to Innovatrix.",
      "",
      "Confirm your email address to finish setting up your account:",
      url,
      "",
      "This link expires in 1 hour. If you didn't create an account, you can ignore this message.",
    ].join("\n"),
  };
}

export function resetPasswordMessage(to: string, url: string): EmailMessage {
  return {
    to,
    kind: "reset-password",
    subject: "Reset your password",
    text: [
      "We received a request to reset the password for this address.",
      "",
      url,
      "",
      "This link can be used once and expires in 1 hour.",
      "If you didn't ask for this, no action is needed — your password hasn't changed.",
    ].join("\n"),
  };
}

export function invitationMessage(input: {
  to: string;
  organizationName: string;
  inviterName: string;
  url: string;
}): EmailMessage {
  return {
    to: input.to,
    kind: "organization-invitation",
    subject: `${input.inviterName} invited you to ${input.organizationName}`,
    text: [
      `${input.inviterName} has invited you to join ${input.organizationName} on Innovatrix.`,
      "",
      input.url,
      "",
      "This invitation expires in 48 hours.",
    ].join("\n"),
  };
}

/**
 * A vendor team invitation — vendor ticket 03.
 *
 * Separate from `invitationMessage` because it invites somebody to *sell*, not to
 * buy, and the two must not read alike: the recipient is about to get access to
 * a product listing and, if promoted, a payout account. Says which vendor and who
 * asked, because an invitation the recipient cannot place is one they report as
 * spam.
 *
 * Reuses the `organization-invitation` kind so the dev transport files it beside
 * the other invitation rather than needing a new `AuthEmailKind` for a difference
 * only the copy cares about.
 */
export function vendorInvitationMessage(input: {
  to: string;
  vendorName: string;
  inviterName: string;
  role: string;
  url: string;
}): EmailMessage {
  return {
    to: input.to,
    kind: "organization-invitation",
    subject: `${input.inviterName} invited you to sell as ${input.vendorName}`,
    text: [
      `${input.inviterName} has invited you to join ${input.vendorName} on Innovatrix, ` +
        `as ${input.role === "owner" ? "an owner" : "a team member"}.`,
      "",
      "Accepting gives you access to that vendor's products and listings. You'll " +
        "need a confirmed email address on your Innovatrix account first.",
      "",
      input.url,
      "",
      "This invitation expires in 48 hours.",
    ].join("\n"),
  };
}
