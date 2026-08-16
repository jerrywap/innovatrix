"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FormErrors } from "@/features/products/components/section-form";
import { TAX_RULE_KINDS } from "@/lib/db/enums";
import { saveTaxRuleAction } from "../actions";

/**
 * Create a tax rule.
 *
 * The rate is typed as whole percent — `20` means 20% — and converted to basis
 * points in the action. The `ruleId` is a slug rather than an id because it is
 * **written onto every order** and read by whoever reconciles them:
 * `uk-digital-vat-20` says what it means and survives a database restore.
 */
export function TaxRuleForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(saveTaxRuleAction, null);
  const failed = state && !state.ok ? state : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border hover:bg-surface-muted flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-[13px]"
      >
        <Plus className="size-3.5" aria-hidden />
        New tax rule
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4"
    >
      <FieldGroup title="New tax rule">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Rule id"
            htmlFor="ruleId"
            hint="Goes on every order. Make it readable — uk-digital-vat-20."
          >
            <Input
              id="ruleId"
              name="ruleId"
              required
              maxLength={60}
              placeholder="uk-digital-vat-20"
              className="font-mono lowercase"
            />
          </Field>

          <Field label="Label" htmlFor="label" hint="For whoever reconciles it.">
            <Input
              id="label"
              name="label"
              required
              maxLength={120}
              placeholder="UK VAT — digital goods"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Country" htmlFor="country" hint="GB, NG — or * for everywhere else.">
            <Input
              id="country"
              name="country"
              required
              maxLength={2}
              placeholder="GB"
              className="font-mono uppercase"
            />
          </Field>

          <Field label="Applies to" htmlFor="kind">
            <select
              id="kind"
              name="kind"
              defaultValue="any"
              className="border-border bg-background h-9 w-full rounded-lg border px-2.5 text-[13px]"
            >
              {TAX_RULE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "digital"
                    ? "Licences"
                    : kind === "service"
                      ? "Services"
                      : "Anything"}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Rate" htmlFor="percent" hint="20 means 20%.">
            <Input id="percent" name="percent" required placeholder="20" inputMode="decimal" />
          </Field>

          <Field label="Priority" htmlFor="priority" hint="Highest wins a genuine tie.">
            <Input id="priority" name="priority" defaultValue="10" inputMode="numeric" />
          </Field>
        </div>
      </FieldGroup>

      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}
      {state?.ok && (
        <p role="status" className="text-[13px] text-emerald-700 dark:text-emerald-300">
          Saved. Existing orders keep the rate they were charged at.
        </p>
      )}

      <div className="flex gap-2">
        <Save />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-subtle px-3 py-1.5 text-[12.5px]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-foreground text-background rounded-lg px-4 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
    >
      {pending ? "Saving…" : "Create rule"}
    </button>
  );
}
