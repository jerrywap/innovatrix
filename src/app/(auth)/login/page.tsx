import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
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

  return (
    <AuthCard
      title="Sign in"
      description="Pick up where you left off."
      footer={
        <>
          New here?{" "}
          <Link href="/register" className="text-signal-text hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm
        next={next}
        notice={justReset ? "Your password has been changed. Sign in with it now." : undefined}
      />
    </AuthCard>
  );
}

function stringParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
