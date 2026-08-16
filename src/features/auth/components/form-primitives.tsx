"use client";

import { useId } from "react";
import { useFormStatus } from "react-dom";

/**
 * Minimal form primitives for the `(auth)` route group, styled with the
 * Meridian tokens.
 *
 * Deliberately hand-rolled rather than waiting for shadcn (ticket 04): auth is
 * the one flow that must work before the design system lands, and these are
 * small enough to be replaced wholesale later. Ticket 04 swaps them for
 * `field`/`button` without changing any page.
 */

export function Field({
  label,
  name,
  type = "text",
  required,
  autoComplete,
  defaultValue,
  placeholder,
  hint,
  errors,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  errors?: string[];
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const invalid = Boolean(errors?.length);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
        {!required && <span className="text-subtle font-normal"> (optional)</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        // Both ids are listed only when they exist, so a screen reader never
        // chases a dangling reference.
        aria-describedby={
          [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(" ") ||
          undefined
        }
        className="border-border bg-surface focus:ring-ring aria-invalid:border-signal w-full rounded-xl border px-3.5 py-2.5 text-[14px] transition outline-none focus:ring-2"
      />
      {hint && !invalid && (
        <p id={hintId} className="text-subtle text-[12.5px]">
          {hint}
        </p>
      )}
      {invalid && (
        <p id={errorId} className="text-signal-text text-[12.5px]">
          {errors?.join(" ")}
        </p>
      )}
    </div>
  );
}

/**
 * Disabled while the action is in flight. `useFormStatus` must be read from a
 * component *inside* the form, which is why this is its own component rather
 * than a prop on the page.
 */
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-signal text-signal-contrast focus-visible:ring-ring mt-1 rounded-full px-5 py-2.5 text-[14px] font-medium transition hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
    >
      {pending ? "Working…" : children}
    </button>
  );
}

/** Form-level error — the one that isn't attached to a field. */
export function FormError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="border-signal/30 bg-signal-soft text-signal-text rounded-xl border px-3.5 py-2.5 text-[13px]"
    >
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="border-border bg-surface-muted rounded-xl border px-3.5 py-2.5 text-[13px]"
    >
      {message}
    </p>
  );
}
