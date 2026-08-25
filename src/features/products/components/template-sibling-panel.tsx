"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Layout } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { FormErrors, useManualSubmit } from "./section-form";
import { PriceMatrix } from "./pricing-form";
import {
  createScriptSiblingAction,
  createTemplateSiblingAction,
  unlinkTemplateSiblingAction,
} from "../actions";
import type { ActionResult } from "@/lib/action-result";
import type { ProductStatus } from "@/lib/db/enums";

/**
 * "Also sell the other half on its own" — a panel on the **review** step.
 *
 * Two directions, one panel. A script offers to spawn its website template; a
 * website template offers to spawn its backend script (COS-9). Which one is drawn
 * comes from `catalogue`, and the only difference between them is copy and which
 * action is dispatched — the pair being created is the same pair either way.
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

/**
 * Both create actions, seen from here.
 *
 * They differ in the id they name — `templateId` / `scriptId` — and agree on
 * `href`, which is the only field this component reads. Typed on the agreement so
 * one form can dispatch either.
 */
export type SiblingCreateAction = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<{ href: string }>>;

export function TemplateSiblingPanel({
  productId,
  catalogue,
  /** The template listing this script already has, if any. */
  sibling,
  /** The script this listing is the front-end of, if it is one. */
  linkedScript,
  /** How many licence packages this listing has — the copy warns when it is >1. */
  licencePackageCount,
  action = createTemplateSiblingAction,
  scriptAction = createScriptSiblingAction,
  unlinkAction = unlinkTemplateSiblingAction,
}: {
  productId: string;
  catalogue: "script" | "template";
  sibling?: TemplateSiblingView;
  linkedScript?: TemplateSiblingView;
  licencePackageCount: number;
  action?: SiblingCreateAction;
  /** The reverse direction — a template spawning its backend script. */
  scriptAction?: SiblingCreateAction;
  unlinkAction?: typeof unlinkTemplateSiblingAction;
}) {
  if (catalogue === "template") {
    // Already the front-end of something: show what, and offer the way out.
    if (linkedScript) {
      return <LinkedNotice script={linkedScript} productId={productId} action={unlinkAction} />;
    }

    /*
     * An unlinked template used to render nothing at all here, which is the hole
     * COS-9 fills: a vendor who listed the front-end first and later built the
     * backend had no way to say so, even though the pair they need is the one the
     * script direction has always produced.
     */
    return (
      <CreateForm
        productId={productId}
        licencePackageCount={licencePackageCount}
        action={scriptAction}
        copy={SCRIPT_DIRECTION}
      />
    );
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
      copy={TEMPLATE_DIRECTION}
    />
  );
}

/**
 * Everything that differs between the two directions.
 *
 * A table rather than two components, because the *form* is identical — the same
 * Radix checkbox with the same reset hazard, the same price matrix, the same
 * created-draft notice. Only the sentences change, and a second copy of the form
 * would be a second place to fix the next reset bug.
 */
interface DirectionCopy {
  heading: string;
  blurb: string;
  checkbox: string;
  submit: string;
  pendingSubmit: string;
  createdHeading: string;
  /** What the new draft still needs before it can go on sale. */
  stillNeeded: string;
}

const TEMPLATE_DIRECTION: DirectionCopy = {
  heading: "Also sell the front-end on its own",
  blurb:
    "Creates a second listing in the website template catalogue — the same design without the backend — at its own price. Buyers of the template see a link back to this one.",
  checkbox: "Create a website template listing",
  submit: "Create the template listing",
  pendingSubmit: "Creating…",
  createdHeading: "The template listing was created",
  /*
    Said before the click, not after.

    The draft is genuinely unfinished: the front-end is a different download, so it
    needs its own upload, and template categories are a separate vocabulary the
    script's categories cannot satisfy. A vendor who learns this from a readiness
    gap afterwards has been surprised by us rather than told.
  */
  stillNeeded:
    "It starts as a draft. Before it can go on sale it needs its own front-end download, its own screenshots and a description, and at least one template category.",
};

const SCRIPT_DIRECTION: DirectionCopy = {
  heading: "Also sell it with the backend",
  blurb:
    "Creates a second listing in the script catalogue — this design plus a working backend — at its own price. This template's page then offers the complete application, and links to it.",
  checkbox: "Create a backend script listing",
  submit: "Create the backend script",
  pendingSubmit: "Creating…",
  createdHeading: "The script listing was created",
  /*
    The mirror of the note above, and deliberately shorter by one clause: a script
    needs no category, because `no_template_category` is templates-only and
    `readiness.ts` says why. Promising a requirement that will never be enforced
    would be its own kind of surprise.
  */
  stillNeeded:
    "It starts as a draft. Before it can go on sale it needs its own full-stack download, its own screenshots and a description of what the backend does.",
};

function CreateForm({
  productId,
  licencePackageCount,
  action,
  copy,
}: {
  productId: string;
  licencePackageCount: number;
  action: SiblingCreateAction;
  copy: DirectionCopy;
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
  /*
   * The created draft, reported here rather than navigated to.
   *
   * The action used to `redirect()` into the new listing's Basics step, which took
   * the vendor out of the Review step they were mid-way through. It now returns the
   * id and the href, so this panel can say what happened and let them decide when
   * to go.
   */
  const created = state && state.ok ? state.data : null;

  return (
    <section className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h2 className="font-display text-[15.5px] tracking-[-0.01em]">{copy.heading}</h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">{copy.blurb}</p>
      </div>

      {created && (
        <div className="border-border bg-surface-muted/40 flex flex-col gap-1.5 rounded-xl border p-3.5">
          <p className="text-[13.5px] font-medium">{copy.createdHeading}</p>
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            It is a <span className="font-medium">draft</span>, so nothing is public yet — and
            you are still on this product&rsquo;s review step. Finish here first if you want to;
            the draft will wait.
          </p>
          <a
            href={created.href}
            className="text-signal-text w-fit text-[13px] underline underline-offset-4"
          >
            Open the new listing →
          </a>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        // Hidden once it has been used: a second submit would be refused by the
        // partial unique index on `scriptListingId`, and offering it again invites
        // a click whose only outcome is an error.
        hidden={Boolean(created)}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="productId" value={productId} />

        <label className="flex items-start gap-2.5">
          <Checkbox
            name="confirm"
            value="on"
            checked={confirmed}
            onCheckedChange={(next) => setConfirmed(next === true)}
            className="mt-0.5"
          />
          <span className="text-[13.5px]">{copy.checkbox}</span>
        </label>

        {confirmed && (
          <div className="flex flex-col gap-2 pl-7">
            <span className="text-[12.5px] font-medium">Price of the new listing</span>
            <PriceMatrix name="prices" prices={[]} context="product" />

            {/* Said before the click, not after — see `DirectionCopy.stillNeeded`. */}
            <p className="text-subtle text-[12.5px] leading-relaxed">
              {copy.stillNeeded}
              {licencePackageCount > 1 &&
                ` This product's ${licencePackageCount} licence packages will all start at the price above — change them on the new listing's own pricing step.`}
            </p>
          </div>
        )}

        {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

        <Submit
          disabled={!confirmed}
          label={copy.submit}
          pendingLabel={copy.pendingSubmit}
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
