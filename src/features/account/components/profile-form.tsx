"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BadgeCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormErrors } from "@/features/products/components/section-form";
import { saveProfileAction } from "../actions";

/**
 * Name, and an honest account of everything else.
 *
 * `<form action={fn}>` is safe here because every control is a native input.
 * `section-form.tsx` documents the exception at length: React 19 requests a form
 * reset *before* a function action runs, native inputs get their fresh
 * `defaultValue` in the same commit, and only Radix controls answer that reset by
 * restoring a stale ref. No Radix control on this form, so no `useManualSubmit`
 * — and the form keeps working with JavaScript off.
 */
export function ProfileForm({
  name,
  email,
  emailVerified,
}: {
  name: string;
  email: string;
  emailVerified: boolean;
}) {
  const [state, submit, pending] = useActionState(saveProfileAction, null);

  return (
    <form action={submit} className="flex flex-col gap-5">
      {state?.ok === false && (
        <FormErrors
          error={state.error}
          {...(state.fieldErrors ? { fieldErrors: state.fieldErrors } : {})}
        />
      )}

      <Field label="Name" htmlFor="account-name" hint="What we call you in emails." required>
        <Input
          id="account-name"
          name="name"
          defaultValue={name}
          required
          maxLength={120}
          autoComplete="name"
        />
      </Field>

      {/*
        Read-only, and it says why rather than presenting a disabled box.
        `/update-user` refuses an email outright, and changing one properly means
        verifying the *new* address before it takes effect — otherwise a typo locks
        the account out of its own password reset. Stated plainly, for the reason
        §69 gives about locked notification rows: a control with no explanation
        reads as a bug.
      */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Email address</span>
        <div className="border-border bg-surface-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
          <span className="font-mono text-[13px]">{email}</span>
          {emailVerified ? (
            <span className="flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-300">
              <BadgeCheck className="size-3.5" aria-hidden />
              Verified
            </span>
          ) : (
            <Link
              href="/verify-email"
              className="flex items-center gap-1.5 text-[12px] text-[var(--warning)] underline underline-offset-4"
            >
              <TriangleAlert className="size-3.5" aria-hidden />
              Not verified — send the link again
            </Link>
          )}
        </div>
        <p className="text-subtle text-[12px]">
          Changing your email address isn&rsquo;t something you can do here yet. Ask us and
          we&rsquo;ll move it for you.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state?.ok && (
          <span role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
