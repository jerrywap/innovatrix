import type { Metadata } from "next";
import Link from "next/link";
import { serverEnv } from "@/config/env";
import { AuthCard } from "@/features/auth/components/auth-card";
import { GoogleButton } from "@/features/auth/components/google-button";
import { LoginForm } from "@/features/auth/components/login-form";
import { optionalRedirectPath } from "@/features/auth/schemas";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;

  // Sanitised here rather than trusted downstream — `next` is attacker-supplied
  // and would otherwise be an open redirect.
  const next = optionalRedirectPath(stringParam(params.next));
  const justReset = params.reset === "1";
  // Set by `/api/auth/stale-session` after it clears a cookie the server had
  // stopped accepting. Without a word here, somebody who was working a moment
  // ago is silently shown a sign-in form and assumes something broke.
  const expired = params.expired === "1";

  return (
    <AuthCard
      title="Sign in"
      description="Pick up where you left off."
      footer={
        <>
          New here?{" "}
          {/*
            `next` travels, which it did not before.

            Without it the commonest first-time funnel — an anonymous assistant
            interview, "Sign in and send", "Create an account" — registered the
            visitor and dropped them on `/dashboard`, nowhere near the interview
            they were part-way through. `registerAction` already honours `next`;
            only the link was missing it. The claim recovers them whenever they
            navigate back, but landing in the right place beats being recoverable.
          */}
          <Link
            href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
            className="text-signal-text hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm
        next={next}
        notice={
          justReset
            ? "Your password has been changed. Sign in with it now."
            : expired
              ? "You were signed out because your session had expired. Sign in to pick up where you left off."
              : undefined
        }
      />

      {/* The flag is server-only by design — no client schema exists in
          `config/env.ts` — so it is read here and crosses as a boolean. */}
      {serverEnv().AUTH_GOOGLE_ENABLED && (
        <div className="mt-5">
          <GoogleButton next={next} label="Continue with Google" />
        </div>
      )}
    </AuthCard>
  );
}

function stringParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
