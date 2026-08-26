"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormErrors } from "@/features/products/components/section-form";
import { changePasswordAction, setPasswordAction } from "../actions";

/**
 * Change a password, or set the first one.
 *
 * Two forms rather than one with a branch, because they ask for different things
 * and mean different things: an account that signed up with Google has no current
 * password to confirm, and asking for one it does not have is how a form becomes
 * unusable. Which one renders is decided by whether a `credential` account exists,
 * and the action checks that again server-side.
 *
 * Native inputs throughout, so `<form action={fn}>` is safe and the form works
 * without JavaScript — see `profile-form.tsx` for why that distinction matters.
 */
export function ChangePassword() {
  const [state, submit, pending] = useActionState(changePasswordAction, null);

  return (
    <form action={submit} className="flex flex-col gap-5">
      {state?.ok === false && (
        <FormErrors
          error={state.error}
          {...(state.fieldErrors ? { fieldErrors: state.fieldErrors } : {})}
        />
      )}
      {state?.ok && (
        <p
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-300"
        >
          Password changed. We&rsquo;ve emailed you to confirm.
        </p>
      )}

      <Field label="Current password" htmlFor="current-password" required>
        <Input
          id="current-password"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </Field>

      <Field
        label="New password"
        htmlFor="new-password"
        hint="At least 12 characters. A passphrase is easier to remember and harder to guess."
        required
      >
        <Input
          id="new-password"
          name="newPassword"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
      </Field>

      <Field label="New password again" htmlFor="confirm-password" required>
        <Input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
      </Field>

      {/*
        A native checkbox, defaulted on. Signing the other devices out is the safe
        default after a password change — if the reason for changing it is that
        somebody else knows the old one, leaving their session alive defeats the
        exercise. Left switchable because it is genuinely annoying when the reason
        was simply that the password was weak.
      */}
      <label className="flex items-start gap-2.5 text-[13px]">
        <input
          type="checkbox"
          name="revokeOtherSessions"
          value="on"
          defaultChecked
          className="border-border-strong accent-signal mt-0.5 size-4 rounded"
        />
        <span>
          Sign out everywhere else
          <span className="text-subtle block text-[12px]">
            Ends every other session. You stay signed in here.
          </span>
        </span>
      </label>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}

export function SetPassword() {
  const [state, submit, pending] = useActionState(setPasswordAction, null);

  return (
    <form action={submit} className="flex flex-col gap-5">
      {state?.ok === false && (
        <FormErrors
          error={state.error}
          {...(state.fieldErrors ? { fieldErrors: state.fieldErrors } : {})}
        />
      )}
      {state?.ok && (
        <p
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-300"
        >
          Password set. You can now sign in with your email address too.
        </p>
      )}

      <Field
        label="New password"
        htmlFor="first-password"
        hint="At least 12 characters."
        required
      >
        <Input
          id="first-password"
          name="newPassword"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
      </Field>

      <Field label="New password again" htmlFor="first-password-confirm" required>
        <Input
          id="first-password-confirm"
          name="confirmPassword"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Setting…" : "Set a password"}
      </Button>
    </form>
  );
}
