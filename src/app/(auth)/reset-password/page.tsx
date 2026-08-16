import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { ResetPasswordForm } from "@/features/auth/components/password-forms";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Better Auth's `requestPasswordReset` sends a link to
 * `/api/auth/reset-password/:token`, which validates the token and redirects
 * here with `?token=`. So the token reaching this page has already been checked
 * once; `resetPasswordAction` checks it again when it is spent, because between
 * the two the user may have taken any amount of time.
 */
export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const params = await searchParams;
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;

  if (!raw || error) {
    return (
      <AuthCard
        title="That link didn't work"
        description="Reset links can be used once and expire after an hour."
        footer={
          <Link href="/forgot-password" className="text-signal-text hover:underline">
            Request a new link
          </Link>
        }
      >
        <p className="text-muted-foreground text-[13.5px]">
          Ask for a new one and it will arrive in a moment.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="This ends your other sessions.">
      <ResetPasswordForm token={raw} />
    </AuthCard>
  );
}
