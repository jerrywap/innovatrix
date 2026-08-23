"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Layout } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { FormErrors, useManualSubmit } from "./section-form";
import { PriceMatrix } from "./pricing-form";
import { createTemplateSiblingAction, unlinkTemplateSiblingAction } from "../actions";
import type { ProductStatus } from "@/lib/db/enums";

/**
 * "Also sell the front-end on its own" — a panel on the **review** step.
 *
 * ## Why the review step and not classification
 *
 * Everything worth copying exists by the time somebody reaches review, and review
 * is already the step whose job is "what is left, and publishing". Classification
 * is step two, where there is nothing to copy yet — and its save is deliberately
 * single-catalogue, writing `catalogue`, four taxonomy fields and `facets` in one
 * `$set` so a product cannot sit in one catalogue carrying the other's terms.
 * Putting a *product insert* inside that write would be the wrong thing in the one
 * place that has to stay atomic about placement.
 *
 * It sits beside `PublishPanel` rather than inside it: creating a product inside a
 * status transition would put an insert inside `transition`'s transaction.
 *
 * ## Its own form, not a `SectionForm`
 *
 * `SectionForm` is for section saves — it emits a `next` field and a
 * continue/stay pair of submits. This creates a second product and navigates to
 * *its* wizard, so it borrows the error rendering and nothing else.
 */

export interface TemplateSiblingView {
  id: string;
  name: string;
  status: ProductStatus;
  /**
   * Where to go to finish it — resolved on the **server**.
   *
   * This was a `hrefFor: (id) => Route` callback, which 500s the page: a function
   * cannot cross the RSC boundary into a client component. `stepHref` needs the
   * surface (`admin` or `vendor`), which the page knows and this component does
   * not, so the page resolves it and the href travels with the listing it points
   * at.
   */
  href: Route;
}

export function TemplateSiblingPanel({
  productId,
  catalogue,
  /** The template listing this script already has, if any. */
  sibling,
  /** The script this listing is the front-end of, if it is one. */
  linkedScript,
  /** How many licence packages the script has — the copy warns when it is >1. */
  licencePackageCount,
  action = createTemplateSiblingAction,
  unlinkAction = unlinkTemplateSiblingAction,
}: {
  productId: string;
  catalogue: "script" | "template";
  sibling?: TemplateSiblingView;
  linkedScript?: TemplateSiblingView;
  licencePackageCount: number;
  action?: typeof createTemplateSiblingAction;
  unlinkAction?: typeof unlinkTemplateSiblingAction;
}) {
  // A template that is the front-end of something: show what, and offer the way out.
  if (catalogue === "template") {
    if (!linkedScript) return null;
    return <LinkedNotice script={linkedScript} productId={productId} action={unlinkAction} />;
  }

  // A script that already has one: point at it rather than offering a second.
  if (sibling) {
    return (
      <section className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4">
        <h2 className="font-display text-[15.5px] tracking-[-0.01em]">
          Website template listing
        </h2>
        <Link
          href={sibling.href}
          className="hover:bg-surface-muted -mx-1 flex items-center gap-2 rounded-lg px-1 py-1 text-[13.5px]"
        >
          <Layout className="text-subtle size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{sibling.name}</span>
          <StatusBadge status={sibling.status} />
          <ArrowRight className="text-subtle size-3.5 shrink-0" aria-hidden />
        </Link>
        <p className="text-subtle text-[12.5px]">
          The front-end of this product, sold on its own. Finish it to publish it.
        </p>
      </section>
    );
  }

  return (
    <CreateForm
      productId={productId}
      licencePackageCount={licencePackageCount}
      action={action}
    />
  );
}

function CreateForm({
  productId,
  licencePackageCount,
  action,
}: {
  productId: string;
  licencePackageCount: number;
  action: typeof createTemplateSiblingAction;
}) {
  /*
    `useManualSubmit`, not `<form action={…}>` — same reason as the wizard steps,
    and this form is the sharpest case of it. `confirm` is a *controlled* Radix
    checkbox, and Radix answers React's pre-action form reset by calling our
    `onCheckedChange` with the value captured at first render: `false`. So a
    validation failure unticked the box, which unmounted the price matrix, which
    lost the price that had just been typed — while displaying the error asking
    for it.
  */
  const { state, pending, onSubmit } = useManualSubmit(action);
  const [confirmed, setConfirmed] = useState(false);
  const failed = state && !state.ok ? state : null;

  return (
    <section className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h2 className="font-display text-[15.5px] tracking-[-0.01em]">
          Also sell the front-end on its own
        </h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
          Creates a second listing in the website template catalogue — the same design without
          the backend — at its own price. Buyers of the template see a link back to this one.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input type="hidden" name="productId" value={productId} />

        <label className="flex items-start gap-2.5">
          <Checkbox
            name="confirm"
            value="on"
            checked={confirmed}
            onCheckedChange={(next) => setConfirmed(next === true)}
            className="mt-0.5"
          />
          <span className="text-[13.5px]">Create a website template listing</span>
        </label>

        {confirmed && (
          <div className="flex flex-col gap-2 pl-7">
            <span className="text-[12.5px] font-medium">Template price</span>
            <PriceMatrix name="prices" prices={[]} context="product" />

            {/*
              Said before the click, not after.

              The draft is genuinely unfinished: the front-end is a different
              download, so it needs its own upload, and template categories are a
              separate vocabulary the script's categories cannot satisfy. A vendor
              who learns this from a readiness gap afterwards has been surprised by
              us rather than told.
            */}
            <p className="text-subtle text-[12.5px] leading-relaxed">
              It starts as a draft. Before it can go on sale it needs its own front-end
              download, its own screenshots and a description, and at least one template
              category.
              {licencePackageCount > 1 &&
                ` This product's ${licencePackageCount} licence packages will all start at the price above — change them on the template's own pricing step.`}
            </p>
          </div>
        )}

        {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

        <Submit
          disabled={!confirmed}
          label="Create the template listing"
          pendingLabel="Creating…"
          pending={pending}
        />
      </form>
    </section>
  );
}

function LinkedNotice({
  script,
  productId,
  action,
}: {
  script: TemplateSiblingView;
  productId: string;
  action: typeof unlinkTemplateSiblingAction;
}) {
  const { state, pending, onSubmit } = useManualSubmit(action);
  const failed = state && !state.ok ? state : null;

  return (
    <section className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4">
      <h2 className="font-display text-[15.5px] tracking-[-0.01em]">Part of a pair</h2>
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        This listing is the front-end of <strong className="font-medium">{script.name}</strong>.
        Its product page offers the complete application, and links there.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <input type="hidden" name="productId" value={productId} />
        {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}
        {/*
          The escape hatch, and the reason `saveClassification` can afford to
          *refuse* a catalogue change on a linked template rather than silently
          clearing the pointer. A refusal with no way forward would be a wall.
        */}
        <Submit variant="ghost" label="Unlink" pendingLabel="Unlinking…" pending={pending} />
      </form>
    </section>
  );
}

/** `pending` is a prop: `useFormStatus` reports nothing for a manual dispatch. */
function Submit({
  label,
  pendingLabel,
  pending,
  disabled,
  variant = "primary",
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost";
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={
        variant === "ghost"
          ? "text-muted-foreground hover:text-foreground self-start text-[12.5px] underline underline-offset-2 disabled:opacity-60"
          : "bg-foreground text-background self-start rounded-full px-4 py-2 text-[13px] font-medium transition hover:opacity-90 disabled:opacity-60"
      }
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
