"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FormErrors } from "@/features/products/components/section-form";
import type { VersionActionSet } from "../action-set";

/**
 * Create a version.
 *
 * Collapsed behind a button rather than always open: the common visit to this
 * screen is to upload a file to the version that already exists, not to start
 * a new one, and a permanently-open create form makes the existing releases the
 * second thing on the page.
 *
 * The version number is the only required field. Everything else can be filled
 * in before release — and release is the point at which it all freezes, so
 * demanding it up front only encourages placeholder text.
 */
export function NewVersionForm({
  productId,
  suggested,
  actions,
}: {
  productId: string;
  /** Vendor ticket 06 — whose actions to call. */
  actions: VersionActionSet;
  /** The next patch after the newest release — a starting point, not a rule. */
  suggested: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(actions.createVersion, null);
  const failed = state && !state.ok ? state : null;

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        New version
      </Button>
    );
  }

  return (
    <form
      action={formAction}
      className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4"
    >
      <input type="hidden" name="productId" value={productId} />

      <FieldGroup
        title="New version"
        description="Created as a draft. Nothing is public until it is released."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Version"
            htmlFor="version-number"
            hint="major.minor.patch — 2.4.0, or 2.4.0-rc.1 for a prerelease."
          >
            <Input
              id="version-number"
              name="version"
              defaultValue={suggested}
              placeholder="1.0.0"
              required
              className="font-mono text-[13px]"
            />
          </Field>

          <Field
            label="Release date"
            htmlFor="version-date"
            hint="Optional. Set on release if blank."
          >
            <Input id="version-date" name="releaseDate" type="date" />
          </Field>
        </div>

        <Field
          label="Changelog"
          htmlFor="version-changelog"
          hint="One line for the version list."
        >
          <Input
            id="version-changelog"
            name="changelog"
            maxLength={300}
            placeholder="Adds bulk invoicing and fixes the CSV export."
          />
        </Field>

        <Field
          label="Minimum requirements"
          htmlFor="version-requirements"
          hint="Frozen once released."
        >
          <Textarea
            id="version-requirements"
            name="minimumRequirements"
            rows={2}
            maxLength={2000}
            placeholder="PHP 8.2, MySQL 8, 2GB RAM"
          />
        </Field>
      </FieldGroup>

      <FieldGroup
        title="Who gets this free"
        description="§45 — recorded here, enforced when a customer downloads."
      >
        <label className="flex items-center gap-2.5 text-[13.5px]">
          <Checkbox name="updateEligibility[includesPriorMajor]" value="on" />
          Owners of any previous major version get this without paying again
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Free from version"
            htmlFor="version-freefrom"
            hint="Overrides the rule above, in both directions."
          >
            <Input
              id="version-freefrom"
              name="updateEligibility[freeFromVersion]"
              placeholder="2.0.0"
              className="font-mono text-[13px]"
            />
          </Field>

          <Field label="Note" htmlFor="version-note" hint="Shown on the download page.">
            <Input
              id="version-note"
              name="updateEligibility[note]"
              maxLength={300}
              placeholder="Free for anyone who bought 2.x."
            />
          </Field>
        </div>
      </FieldGroup>

      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <div className="flex gap-2">
        <Create />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Create() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Creating…" : "Create version"}
    </Button>
  );
}
