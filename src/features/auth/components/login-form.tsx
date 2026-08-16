"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction } from "../actions";
import { Field, FormError, FormNotice, SubmitButton } from "./form-primitives";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, formAction] = useActionState(signInAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormNotice message={notice} />
      <FormError message={failed?.error} />

      {/* Carried through the form rather than read from the URL in the action:
          the action has no access to the page's query string. */}
      {next && <input type="hidden" name="next" value={next} />}

      <Field
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        errors={failed?.fieldErrors?.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        errors={failed?.fieldErrors?.password}
      />

      <div className="flex items-center justify-between">
        <label className="text-muted-foreground flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            name="rememberMe"
            className="border-border accent-signal size-3.5 rounded"
          />
          Stay signed in
        </label>
        <Link href="/forgot-password" className="text-signal-text text-[13px] hover:underline">
          Forgot password?
        </Link>
      </div>

      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
