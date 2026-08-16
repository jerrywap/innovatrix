"use client";

import { useActionState } from "react";
import { registerAction } from "../actions";
import { Field, FormError, SubmitButton } from "./form-primitives";

export function RegisterForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(registerAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={failed?.error} />

      {next && <input type="hidden" name="next" value={next} />}

      <Field
        label="Your name"
        name="name"
        required
        autoComplete="name"
        errors={failed?.fieldErrors?.name}
      />
      <Field
        label="Work email"
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
        autoComplete="new-password"
        hint="At least 12 characters. A short phrase beats a short password."
        errors={failed?.fieldErrors?.password}
      />
      <Field
        label="Company name"
        name="organizationName"
        autoComplete="organization"
        placeholder="Acme Ltd"
        hint="Leave blank if it's just you — you can add colleagues later."
        errors={failed?.fieldErrors?.organizationName}
      />

      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}
