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
          ? `We sent a link to ${session.user.email}. Open it to finish setting up.`
          : "We sent you a link. Open it to finish setting up your account."
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
        {session && <ResendVerification />}
      </div>
    </AuthCard>
  );
}
