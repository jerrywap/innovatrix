import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { RegisterForm } from "@/features/auth/components/register-form";
import { optionalRedirectPath } from "@/features/auth/schemas";

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
          <Link href="/login" className="text-signal-text hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm next={next} />
    </AuthCard>
  );
}
