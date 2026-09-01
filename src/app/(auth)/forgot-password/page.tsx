import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { ForgotPasswordForm } from "@/features/auth/components/password-forms";
import { parkedReturnPath } from "@/lib/auth/dal";
import { loginPath } from "@/lib/return-path";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage() {
  // The URL cannot carry a destination across a password-reset email, so the
  // parked one is what "back to sign in" has to read.
  const parked = await parkedReturnPath();

  return (
    <AuthCard
      title="Reset your password"
      description="We'll email you a link to set a new one."
      footer={
        <Link href={loginPath(parked)} className="text-signal-text hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
