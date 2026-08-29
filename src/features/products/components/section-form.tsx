"use client";

import Link from "next/link";
import { createContext, useActionState, useContext, useEffect, useRef } from "react";
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
  /**
   * The `<form>` element, for a caller that needs to read a field it does not
   * own in React state.
   *
   * The basics step uses it so the rewrite button can pick up the product name —
   * an uncontrolled input with a `defaultValue`, like most of this wizard.
   * Lifting every such field into state to hand two strings to a model would
   * turn a step with no re-renders into one with a render per keystroke.
   */
  formRef?: React.Ref<HTMLFormElement>;
}

export function SectionForm({
  action,
  children,
  nextHref,
  nextLabel = "Save and continue",
  productId,
  disabled,
  disabledReason,
  formRef,
}: SectionFormProps) {
  const { state, pending, onSubmit } = useManualSubmit(action);
  const failed = state && !state.ok ? state : null;
  const saved = state?.ok === true;

  /*
   * Move to the error when one appears.
   *
   * The summary renders at the **top** of the form and the submit buttons are at
   * the bottom, which on a short wizard step is fine and on a long one is a form
   * that appears to do nothing. The vendor application is the case that showed
   * it: seven fields, an agreement gate, and the one thing a person can fail —
   * not accepting the agreement — reports itself three screens above where they
   * clicked. It looked like the button was dead.
   *
   * Focus does the work, and moving focus is the point rather than a side effect
   * of it: a `role="alert"` with `tabIndex={-1}` reaches somebody on a screen
   * reader *and* somebody on a keyboard, who would otherwise carry on tabbing
   * from a button below the message they cannot see.
   *
   * **Plain `focus()`, deliberately not `scrollIntoView`.** The first version
   * called both and the scroll overshot badly: these forms sit inside the app
   * shell's own scroll container, and `scrollIntoView` walks every scrollable
   * ancestor, which left the layout scrolled past its own end with the form
   * halfway up an empty screen. The browser's own focus scrolling moves the
   * minimum needed and gets nested scrollers right, which is precisely the case
   * a hand-rolled scroll gets wrong.
   *
   * Keyed on `state`, not on `failed`: two consecutive failed submissions
   * produce a new object each time, so a second attempt that fails the same way
   * moves the reader again rather than sitting silent.
   */
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!failed) return;
    alertRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `state` is the identity that changes per submission; `failed` is derived from it.
  }, [state]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
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

      {failed && (
        <FormErrors ref={alertRef} error={failed.error} fieldErrors={failed.fieldErrors} />
      )}

      {/*
        Field errors travel down so a control can mark *itself*, which is what
        makes "check the highlighted fields" true rather than an instruction with
        nothing behind it. The summary stays regardless — it is the only thing
        that works when the failing field is off-screen, which is the argument
        `FormErrors` makes about itself.
      */}
      <FieldErrorContext value={failed?.fieldErrors ?? null}>
        <fieldset disabled={disabled} className="flex flex-col gap-6 border-0 p-0">
          {children}
        </fieldset>
      </FieldErrorContext>

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
 *
 * ## Each line names its field
 *
 * It used to print `messages.join(" ")` and nothing else, which is how a vendor
 * came to report *"Please check the highlighted fields. Invalid input: expected
 * object, received string"* with no idea which field, and no highlighted field to
 * check either. A Zod type error is unreadable on its own and perfectly readable
 * with a name in front of it.
 *
 * `FIELD_LABELS` covers the paths a person would not recognise; anything else is
 * de-camel-cased, which handles `websiteUrl` and `supportEmail` without an entry.
 * A dotted or indexed path — `licencePackages.0.prices` — keeps its shape, because
 * "the first licence package" is a guess and the path is not.
 */
export function FormErrors({
  error,
  fieldErrors,
  className,
  ref,
}: {
  error: string;
  fieldErrors?: Record<string, string[]>;
  className?: string;
  /** So `SectionForm` can move focus here when a submission fails. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  const entries = Object.entries(fieldErrors ?? {});

  return (
    <div
      ref={ref}
      role="alert"
      // `-1`: reachable by script, never in the tab order. A summary that
      // collected a tab stop of its own would put a stop in front of every field
      // on every subsequent pass through the form.
      tabIndex={-1}
      className={cn(
        /*
          `scroll-mt-24` clears the sticky app header. Without it the browser's
          focus scroll does its job to the letter and leaves the summary forty
          pixels *under* the header — focus on something invisible, which is the
          one outcome worse than not scrolling.
        */
        "focus-visible:ring-ring scroll-mt-24 focus-visible:ring-2 focus-visible:outline-none",
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
            <li key={field}>
              <span className="font-medium">{fieldLabel(field)}:</span> {messages.join(" ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Paths whose de-camel-cased form would still not read as English. */
const FIELD_LABELS: Record<string, string> = {
  description: "Description",
  seo: "Search listing",
  demo: "Demo",
  prices: "Price",
  licencePackages: "Licence packages",
  addons: "Add-ons",
  media: "Screenshots and video",
  categoryIds: "Categories",
  industryIds: "Industries",
  technologyIds: "Technologies",
  productTypeId: "Product type",
  releaseNotes: "Release notes",
};

function fieldLabel(path: string): string {
  const [head] = path.split(".");
  const known = head ? FIELD_LABELS[head] : undefined;
  if (known) return path.includes(".") ? `${known} (${path})` : known;

  // `websiteUrl` → `Website url`. Crude, and right far more often than a lookup
  // table somebody has to remember to extend.
  return path
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
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
  action,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
  /**
   * A control that belongs to this field rather than to the form — the AI
   * rewrite button is the only one so far.
   *
   * Beside the label rather than under the control, because it acts *on* the
   * field: below it, it reads as another thing to fill in, and on a long step it
   * ends up nearer the next field's label than its own.
   */
  action?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={htmlFor} className="text-[13px] font-medium">
          {label}
          {!required && <span className="text-subtle font-normal"> (optional)</span>}
        </label>
        {action}
      </div>
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

/* ────────────────────────────────────────────── field errors, downward */

/**
 * The failing fields of the last submission, for controls that can mark themselves.
 *
 * ## Why a context rather than a prop
 *
 * `SectionForm` takes `children`, so it never sees the controls it wraps and
 * cannot hand anything to one three levels down. Threading a prop through would
 * mean every intermediate component carrying a value it does not use, and the
 * ones that forgot would be exactly the ones whose errors went missing — the
 * failure mode central rendering was introduced to end.
 *
 * `null` outside a `SectionForm`, so `useFieldError` is safe anywhere and simply
 * reports nothing.
 */
const FieldErrorContext = createContext<Record<string, string[]> | null>(null);

/**
 * The message for one field, if the last submission rejected it.
 *
 * Deliberately **not** used by most controls. A native input with `required` is
 * refused by the browser before a submit is dispatched, so a server error on one
 * is rare and the summary covers it. This exists for the controls the browser
 * cannot check — the agreement gate being the one that proved it necessary,
 * since the only way to fail that form is the one field with no native
 * validation behind it.
 */
export function useFieldError(name: string): string | undefined {
  return useContext(FieldErrorContext)?.[name]?.join(" ");
}
