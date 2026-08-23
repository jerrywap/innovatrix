"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";

/**
 * The shell every wizard section's form sits in.
 *
 * Owns the three things each of the ten steps would otherwise reimplement:
 * submission state, error rendering, and the save/continue pair.
 *
 * ## Two buttons, deliberately
 *
 * **Save** stays put; **Save and continue** moves on. The ticket's requirement
 * is that work is never lost, and the honest reading of that is a person who
 * wants to fix one field and stay where they are must not be teleported to the
 * next step for the privilege of saving.
 *
 * ## Field errors are rendered here, once
 *
 * `withAction` returns `fieldErrors` keyed by path. Rendering them centrally
 * means a validation message cannot go missing because one step forgot to wire
 * it up — the usual outcome being a form that refuses to save and never says
 * why.
 *
 * ## Why the submit is dispatched by hand — read this before "simplifying" it
 *
 * This form deliberately does **not** use `<form action={fn}>`. It was, and that
 * silently destroyed data on four of the ten steps.
 *
 * React 19 routes a function `action` through `startHostTransition`, which
 * requests a real DOM `form.reset()` **before the action runs**:
 *
 * ```js
 * null === action ? noop : function () { requestFormReset(formFiber); return action(formData); }
 * ```
 *
 * Native inputs survive that, because React writes their fresh `defaultValue` in
 * the mutation phase of the same commit — which is why the text-only steps
 * looked fine and nobody suspected the shell. Radix's Checkbox, Select and Switch
 * do not: each answers a `reset` event by restoring a ref captured on **first
 * render**, so they revert to first paint — on a fresh draft, to nothing. An
 * unchecked box submits nothing at all, `idListSchema` turns absent into `[]`, and
 * the *next* save writes empty arrays over the categories just stored, reporting
 * success. It fires on failed submits too, wiping what was typed before the
 * error could be read.
 *
 * Making the control controlled does not help: Radix's reset handler calls the
 * `onChange` of a controlled prop with the stale value, so our own state is
 * overwritten instead.
 *
 * Calling `preventDefault()` is what fixes it. React reaches that branch with
 * `action === null` and routes to `noop`, so no reset is ever requested —
 * `requestFormReset` is exported precisely so a manual dispatcher can opt *in*,
 * which this one does not. One change here covers all ten steps, both the admin
 * and the vendor surface, and the failed-submit case.
 *
 * The cost, accepted knowingly: the text steps lose progressive enhancement.
 * That is smaller than it reads — every `Select` in this wizard, along with the
 * repeaters, the uploader and the editor, is already unusable without JS.
 *
 * Browser constraint validation is unaffected: `required` and `pattern` are
 * checked before `submit` fires, so `SLUG_INPUT_ATTRS` still speaks first.
 */

/**
 * Submit state plus a handler that dispatches without letting React reset the form.
 *
 * Exported because the trap is not specific to `SectionForm` — see the note
 * above. `template-sibling-panel.tsx` uses it for the same reason.
 *
 * `new FormData(form, submitter)` rather than `new FormData(form)`: the one-argument
 * form omits the submitter's own entry, which is how the `intent` field that
 * distinguishes "Save" from "Save and continue" would go missing and navigation
 * would quietly stop happening.
 */
export function useManualSubmit<T>(
  action: (previous: T | null, formData: FormData) => Promise<T>,
) {
  const [state, dispatch, pending] = useActionState(action, null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // The whole point. See the docblock above.
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    dispatch(new FormData(event.currentTarget, submitter));
  }

  return { state, pending, onSubmit };
}

export interface SectionFormProps {
  action: (
    previous: ActionResult<unknown> | null,
    formData: FormData,
  ) => Promise<ActionResult<unknown>>;
  children: React.ReactNode;
  /** Where "Save and continue" goes. Absent on the last step. */
  nextHref?: string;
  nextLabel?: string;
  /** Reflected into a hidden field so the action knows what it is saving. */
  productId?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function SectionForm({
  action,
  children,
  nextHref,
  nextLabel = "Save and continue",
  productId,
  disabled,
  disabledReason,
}: SectionFormProps) {
  const { state, pending, onSubmit } = useManualSubmit(action);
  const failed = state && !state.ok ? state : null;
  const saved = state?.ok === true;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {productId && <input type="hidden" name="productId" value={productId} />}
      {nextHref && <input type="hidden" name="next" value={nextHref} />}

      {disabled && disabledReason && (
        <p
          role="status"
          className="border-border bg-surface-muted text-muted-foreground rounded-xl border px-3.5 py-2.5 text-[13px]"
        >
          {disabledReason}
        </p>
      )}

      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <fieldset disabled={disabled} className="flex flex-col gap-6 border-0 p-0">
        {children}
      </fieldset>

      <div className="border-border flex flex-wrap items-center gap-2 border-t pt-5">
        <SubmitButtons
          nextHref={nextHref}
          nextLabel={nextLabel}
          disabled={disabled}
          pending={pending}
        />
        {saved && <SavedNotice />}
      </div>
    </form>
  );
}

/**
 * `pending` arrives as a prop rather than from `useFormStatus`.
 *
 * `useFormStatus` reports on a submission React is driving. A manual `dispatch`
 * is not one, so it would read `false` throughout the save — leaving both
 * buttons live and the labels never reaching "Saving…".
 */
function SubmitButtons({
  nextHref,
  nextLabel,
  disabled,
  pending,
}: {
  nextHref?: string;
  nextLabel: string;
  disabled?: boolean;
  pending: boolean;
}) {
  return (
    <>
      {nextHref && (
        <Button type="submit" name="intent" value="continue" disabled={pending || disabled}>
          {pending ? "Saving…" : nextLabel}
        </Button>
      )}
      <Button
        type="submit"
        name="intent"
        value="stay"
        variant={nextHref ? "outline" : "default"}
        disabled={pending || disabled}
      >
        {pending ? "Saving…" : "Save"}
      </Button>
    </>
  );
}

function SavedNotice() {
  return (
    <span role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300">
      <Check className="mr-1 inline size-3.5" aria-hidden />
      Saved
    </span>
  );
}

/**
 * The form-level message plus every field error.
 *
 * Field errors are listed rather than only shown inline because a long form
 * scrolls: an inline message on a field three screens down is a form that
 * silently refuses to save.
 */
export function FormErrors({
  error,
  fieldErrors,
  className,
}: {
  error: string;
  fieldErrors?: Record<string, string[]>;
  className?: string;
}) {
  const entries = Object.entries(fieldErrors ?? {});

  return (
    <div
      role="alert"
      className={cn(
        "border-destructive/30 bg-destructive/10 flex flex-col gap-1.5 rounded-xl border px-3.5 py-3",
        className,
      )}
    >
      <p className="text-destructive flex items-center gap-1.5 text-[13.5px] font-medium">
        <TriangleAlert className="size-3.5" aria-hidden />
        {error}
      </p>

      {entries.length > 0 && (
        <ul className="text-destructive/90 ml-5 list-disc text-[12.5px]">
          {entries.map(([field, messages]) => (
            <li key={field}>{messages.join(" ")}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A labelled field. Deliberately not shadcn's `Field`, which assumes a
 * component-per-control; these forms are mostly native inputs.
 */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  required,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
        {!required && <span className="text-subtle font-normal"> (optional)</span>}
      </label>
      {children}
      {hint && <p className="text-subtle text-[12.5px]">{hint}</p>}
    </div>
  );
}

/** A titled group within a step, so long forms stay scannable. */
export function FieldGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">{title}</h2>
        {description && (
          <p className="text-muted-foreground mt-0.5 text-[13px]">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** Used by the review step to link a publish gap to the step that fixes it. */
export function GapLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href as never} className="text-signal-text hover:underline">
      {children}
    </Link>
  );
}
