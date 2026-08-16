"use client";

import { useActionState } from "react";
import { forgotPasswordAction, resetPasswordAction } from "../actions";
import { Field, FormError, FormNotice, SubmitButton } from "./form-primitives";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, null);
  const failed = state && !state.ok ? state : null;
  const sent = state?.ok === true;

  // The success message is deliberately identical whether or not the address
  // exists — §88. Do not "improve" this by confirming the account was found.
  if (sent) {
    return (
      <FormNotice message="If that address has an account, a reset link is on its way. It expires in an hour." />
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={failed?.error} />
      <Field
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        errors={failed?.fieldErrors?.email}
      />
      <SubmitButton>Send reset link</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(resetPasswordAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={failed?.error} />
      <input type="hidden" name="token" value={token} />
      <Field
        label="New password"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        hint="At least 12 characters."
        errors={failed?.fieldErrors?.password}
      />
      <Field
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        required
        autoComplete="new-password"
        errors={failed?.fieldErrors?.confirmPassword}
      />
      <SubmitButton>Set new password</SubmitButton>
    </form>
  );
}
