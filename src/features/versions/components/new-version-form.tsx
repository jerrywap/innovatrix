"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FormErrors,
  useManualSubmit,
} from "@/features/products/components/section-form";
import type { DeliveryMethod } from "@/lib/db/enums";
import { VersionNumberField } from "./version-number-field";
import type { VersionActionSet } from "../action-set";

/**
 * One form: how the bytes reach us, which version this is, and what is in it.
 *
 * ## What it replaced
 *
 * Three separate saves, in an order nobody could infer. A vendor picked a delivery
 * method in one form and pressed *Save*; pressed *New version* to open a second
 * form and pressed *Create version*; then hunted for a **Release** button that
 * lived in the version's own header row, nowhere near the upload control that
 * would let it succeed. Each step worked, and together they read as three
 * unrelated screens.
 *
 * They are one decision made once, so they are one form, in the order the work
 * happens: how you supply it → which version → what changed → who gets it free.
 * The delivery method is still a *product* field and the version is still a draft;
 * what changed is that the vendor states both in one go.
 *
 * ## Open by default for a first version
 *
 * It used to be collapsed always, on the reasoning that the common visit is to
 * upload to a version that already exists. True on a *published* product, and
 * exactly wrong on the wizard step, where there are no versions and the whole
 * purpose of arriving is to make one — the vendor met a page whose only control
 * was a button labelled "New version" beside a paragraph about submission.
 *
 * ## Manual dispatch, not `<form action={fn}>`
 *
 * The eligibility control is a Radix `Checkbox`, and React 19 requests a DOM
 * `form.reset()` *before* running a function action — which Radix answers by
 * restoring a mount-time ref. A duplicate version number is the common failure
 * here (`version-service` refuses it), so the whole form was being wiped before
 * the error could be read. See the docblock on `useManualSubmit`.
 */
export function NewVersionForm({
  productId,
  suggested,
  actions,
  method,
  hasVersions,
}: {
  productId: string;
  /** Vendor ticket 06 — whose actions to call. */
  actions: VersionActionSet;
  /** The next patch after the newest release — a starting point, not a rule. */
  suggested: string;
  /**
   * The product's current delivery method, when this surface lets it be chosen.
   *
   * Vendor-only. Staff products are always `archive`, so the admin page passes
   * nothing and the fieldset does not render — rather than showing a choice that
   * surface does not make.
   */
  method?: DeliveryMethod;
  /** Collapse behind a button. A product with no versions shows the form. */
  hasVersions: boolean;
}) {
  const [open, setOpen] = useState(!hasVersions);
  const { state, pending, onSubmit } = useManualSubmit(actions.createVersion);
  const failed = state && !state.ok ? state : null;

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        Add another version
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="border-border bg-surface flex flex-col gap-5 rounded-xl border p-5"
    >
      <input type="hidden" name="productId" value={productId} />

      {method && (
        <FieldGroup
          title="How you supply your software"
          description="Saved with this version. Changing it later leaves every released version downloadable."
        >
          <div className="flex flex-col gap-3">
            {DELIVERY_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="method"
                  value={option.value}
                  defaultChecked={option.value === method}
                  className="mt-1 accent-[var(--signal)]"
                />
                <span>
                  <span className="text-[13px] font-medium">{option.label}</span>
                  <span className="text-muted-foreground block text-[12.5px] leading-relaxed">
                    {option.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </FieldGroup>
      )}

      <FieldGroup
        title="Which version is this?"
        description="Created as a draft. Nothing is public until you release it."
      >
        <VersionNumberField suggested={suggested} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Release date"
            htmlFor="version-date"
            hint="Optional. Set on release if blank."
          >
            <Input id="version-date" name="releaseDate" type="date" />
          </Field>

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
        </div>

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
        description="Recorded here, enforced when a customer downloads."
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

      <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
        {/*
          `pending` travels as a prop rather than coming from `useFormStatus`, which
          reports nothing for a manual dispatch — the reason is in `useManualSubmit`.
        */}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create this version"}
        </Button>
        {hasVersions && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
        <p className="text-subtle text-[12.5px]">
          You will add the file — and release it — on the version itself.
        </p>
      </div>
    </form>
  );
}

/**
 * The three delivery methods, and copy that says what actually happens.
 *
 * Lifted verbatim from `DeliveryMethodPicker`, which this fieldset replaces. Two
 * of the three names mislead: "we fetch it from your server" is spelled out
 * rather than called "self-hosted", which a vendor reads as "customers download
 * from me". The ticket's rule is that an unimplemented option in a dropdown is a
 * support thread — all three work, so all three are here.
 */
const DELIVERY_OPTIONS: ReadonlyArray<{
  value: DeliveryMethod;
  label: string;
  detail: string;
}> = [
  {
    value: "archive",
    label: "Upload a package",
    detail: "You upload the file here. Simplest, and what most vendors want.",
  },
  {
    value: "vendor_hosted",
    label: "We fetch it from your server",
    detail:
      "You give us a URL and a checksum. We fetch it once and serve our own copy — your " +
      "server going down does not take your product down.",
  },
  {
    value: "repository",
    label: "We pull a tag from your repository",
    detail:
      "GitHub or GitLab. We pull that tag's tarball once and serve our own copy. We do not " +
      "add customers to your repository.",
  },
];
