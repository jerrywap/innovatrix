import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

/* ────────────────────────────────────────────── selection */

let transport: EmailTransport | undefined;

/** Ticket 24 replaces the body of this function, not its callers. */
function resolveTransport(): EmailTransport {
  // if (serverEnv().RESEND_API_KEY) return resendTransport();   ← ticket 24
  return consoleAndFileTransport;
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
