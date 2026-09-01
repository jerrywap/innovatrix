import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { ResendVerification } from "@/features/auth/components/resend-verification";
import { getSession, parkedReturnPath } from "@/lib/auth/dal";
import { loginPath } from "@/lib/return-path";

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
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const [session, params, parked] = await Promise.all([
    getSession(),
    searchParams,
    parkedReturnPath(),
  ]);

  /*
   * Better Auth redirects here with `?error=…` when a token is rejected, and an
   * hour's expiry means people meet this. Any value is treated the same way: the
   * distinction between "expired" and "already used" changes nothing a reader
   * can act on, and matching their exact vocabulary would be a guess that breaks
   * quietly on an upgrade. What matters is that the page stops saying "open the
   * link we emailed you" to somebody who just did.
   *
   * Checked before the verified branch, but *after* it in effect: a link reused
   * once it has done its job arrives with both an error and a verified session,
   * and "you're all set" is the truer answer there.
   */
  const rejected = !session?.user.emailVerified && typeof params.error === "string";

  if (session?.user.emailVerified) {
    return (
      <AuthCard
        title="You're all set"
        description="Your email address is confirmed."
        footer={
          /*
            **The hop the return cookie exists for.**
            
            The confirmation email's `callbackURL` is a constant `/verify-email`
            by design — `confirmationLanding()` argues that a destination baked
            into a link that sits in an inbox for an hour is worse than one that
            expires with the journey. So this screen is where a signup that began
            on `/sell` or a product page used to end, unconditionally, at the
            dashboard. The parked path is what carries it the rest of the way.
          */
          <Link href={parked ?? "/dashboard"} className="text-signal-text hover:underline">
            {parked ? "Continue where you left off" : "Go to your dashboard"}
          </Link>
        }
      >
        <p className="text-muted-foreground text-[13.5px]">Nothing else to do here.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={rejected ? "That link has expired" : "Confirm your email"}
      description={
        rejected
          ? "Confirmation links last an hour. Send yourself a fresh one."
          : session
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

        {session ? (
          <div className="flex flex-col gap-2">
            {/*
              Two different problems, so two different sentences. Telling somebody
              whose link expired to check their spam folder sends them looking for
              the mail they just opened.
            */}
            <p className="text-muted-foreground text-[13.5px]">
              {rejected
                ? "Nothing is wrong with your account — the link simply timed out."
                : "Can’t find it? Check your spam folder, then send yourself a fresh link — the last one expires an hour after it was sent."}
            </p>
            <ResendVerification />
          </div>
        ) : (
          rejected && (
            /*
              An expired link opened where there is no session — a different device,
              or one that has since signed out. `ResendVerification` needs a session
              to know whom to send to, so the only honest next step is signing in,
              from where the button above is one page away.
            */
            <p className="text-muted-foreground text-[13.5px]">
              <Link href={loginPath(parked)} className="text-signal-text hover:underline">
                Sign in
              </Link>{" "}
              and we&rsquo;ll offer you a fresh link.
            </p>
          )
        )}
      </div>
    </AuthCard>
  );
}
