"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createProductAction } from "../actions";
import type { ActionResult } from "@/lib/action-result";
import { FormErrors } from "./section-form";
import { RichTextEditor } from "./rich-text-editor";

/**
 * The create form — name, summary, and optionally the description.
 *
 * Deliberately short. The wizard's promise is that work is never lost, and the
 * way to keep it is to get a draft into the database as early as possible.
 * Asking for pricing and media here would mean an administrator who gets
 * interrupted after ten minutes has nothing saved.
 *
 * The slug is derived from the name and is not asked for. Changing it later is
 * its own action, because it retires the old address into `slugHistory` and
 * that is a different kind of decision from fixing a typo in a title.
 */
/**
 * `action` is a prop so this serves both wizard surfaces — vendor ticket 04.
 *
 * Defaulted to the staff action. The vendor variant stamps ownership from the
 * session, which is why creation is a *different action* rather than this form
 * gaining a vendor field: a `vendorId` in a request body is a claim about whose
 * catalogue a product joins.
 */
export function NewProductForm({
  action = createProductAction,
}: {
  action?: (
    previous: ActionResult<never> | null,
    formData: FormData,
  ) => Promise<ActionResult<never>>;
} = {}) {
  const [state, formAction] = useActionState(action, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Name</span>
        <Input
          name="name"
          required
          minLength={2}
          maxLength={120}
          placeholder="Atlas CRM"
          autoFocus
        />
        <span className="text-subtle text-[12.5px]">
          The web address is made from this. You can change it later.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Summary</span>
        <Textarea
          name="summary"
          required
          minLength={10}
          maxLength={300}
          rows={2}
          placeholder="A CRM for property managers, with tenancy tracking and automated rent reminders."
        />
        <span className="text-subtle text-[12.5px]">
          One line. It appears on every marketplace card, so write it for someone skimming.
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">
          Description <span className="text-subtle font-normal">(optional)</span>
        </span>
        <RichTextEditor name="description" />
        <span className="text-subtle text-[12.5px]">
          Needed before publishing, but not to save a draft.
        </span>
      </div>

      <div className="border-border flex items-center gap-2 border-t pt-5">
        <CreateButton />
      </div>
    </form>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create draft"}
    </Button>
  );
}
