import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { ResendVerification } from "@/features/auth/components/resend-verification";
import { getSession } from "@/lib/auth/dal";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Confirm your email" };

/**
 * Where someone lands after signing up, and where checkout sends them if their
 * address is still unconfirmed (§75).
 *
 * The link in the email goes to Better Auth's own endpoint, which verifies and
 * redirects — this page is only the waiting room and the "send it again" path.
 *
 * ## This page does not send anything, and must not say that it did
 *
 * It used to open with "We sent a link to you@example.com", which is true only
 * on the one route that reaches it straight after registration — the send is
 * Better Auth's `sendOnSignUp`, fired when the account is created. Arrive here
 * any other way (a bookmark, the checkout gate, an hour later) and the sentence
 * asserts a send that did not happen, which reads as the mail being broken when
 * it is merely old.
 *
 * The alternative — sending on load — is worse than a wording bug. A GET that
 * sends email means a refresh sends another, and the page is reachable by
 * anyone signed in; the throttle in `auth.ts` would be the only thing between
 * a held-down F5 and a spam complaint. So the copy tells the truth instead, and
 * the deliberate resend is one button away.
 */
export default async function VerifyEmailPage() {
  const session = await getSession();

  if (session?.user.emailVerified) {
    return (
      <AuthCard
        title="You're all set"
        description="Your email address is confirmed."
        footer={
          <Link href="/dashboard" className="text-signal-text hover:underline">
            Go to your dashboard
          </Link>
        }
      >
        <p className="text-muted-foreground text-[13.5px]">Nothing else to do here.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Confirm your email"
      description={
        session
          ? `Open the link we emailed to ${session.user.email} to finish setting up.`
          : "Open the link we emailed you to finish setting up your account."
      }
      footer={
        <Link href="/" className="text-signal-text hover:underline">
          Back to the marketplace
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-[13.5px]">
          You can browse without confirming. You&rsquo;ll need a confirmed address before
          checking out.
        </p>
        {session && (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-[13.5px]">
              Can&rsquo;t find it? Check your spam folder, then send yourself a fresh link
              &mdash; the last one expires an hour after it was sent.
            </p>
            <ResendVerification />
          </div>
        )}
      </div>
    </AuthCard>
  );
}
