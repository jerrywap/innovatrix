import type { Metadata } from "next";
import Link from "next/link";
import { serverEnv } from "@/config/env";
import { AuthCard } from "@/features/auth/components/auth-card";
import { GoogleButton } from "@/features/auth/components/google-button";
import { RegisterForm } from "@/features/auth/components/register-form";
import { loginPath, optionalRedirectPath } from "@/lib/return-path";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Create an account" };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const params = await searchParams;
  const next = optionalRedirectPath(Array.isArray(params.next) ? params.next[0] : params.next);

  return (
    <AuthCard
      title="Create an account"
      description="Browse the marketplace, request custom work, and track delivery in one place."
      footer={
        <>
          Already have an account?{" "}
          {/*
            `next`, in both directions. The login page has always carried it into
            here; this link threw it away, so somebody who was bounced to
            `/login?next=…`, clicked "Create an account", realised they already
            had one and clicked back landed on the dashboard.
          */}
          <Link href={loginPath(next)} className="text-signal-text hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm next={next} />

      {/* Same account either way: `trustedProviders: ["google"]` links a Google
          sign-in to an existing email account rather than duplicating it. */}
      {serverEnv().AUTH_GOOGLE_ENABLED && (
        <div className="mt-5">
          <GoogleButton next={next} label="Sign up with Google" />
        </div>
      )}
    </AuthCard>
  );
}
