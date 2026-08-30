"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { MultiSelect } from "@/components/multi-select";
import { NativeSelect } from "@/components/native-select";
import { Field, FieldGroup, SectionForm, type SectionFormProps } from "./section-form";
import { saveClassificationAction } from "../actions";
import type { AdminProductView } from "@/services/catalog/product-view";
import type { ProductCatalogue, TaxonomyCatalogue, TaxonomyKind } from "@/lib/db/enums";

export interface TaxonomyOption {
  id: string;
  name: string;
  /** Which catalogue's vocabulary it belongs to — `both` for most. */
  catalogue: TaxonomyCatalogue;
  /** A category's parent. Absent on a root and on every other kind. */
  parentId?: string;
}

/**
 * Categories in tree order — each root, then its children — with the parent's
 * name on every child so `MultiSelect` can indent and announce it.
 *
 * The order matters as much as the labels: a flat alphabetical list of a
 * two-level vocabulary reads as noise, and the picker's search is the only other
 * way through it.
 *
 * A term whose parent is not in this (catalogue-filtered) list is treated as a
 * root, matching `rootCategories` on the read side. Deactivate one parent and its
 * children stay pickable rather than vanishing from the form.
 */
function asTree(options: readonly TaxonomyOption[]): TaxonomyOption[] {
  const byId = new Map(options.map((option) => [option.id, option]));
  const roots = options.filter((option) => !option.parentId || !byId.has(option.parentId));

  return roots.flatMap((root) => [
    root,
    ...options
      .filter((option) => option.parentId === root.id)
      .map((child) => ({ ...child, group: root.name })),
  ]);
}

/**
 * Where a product sits in the marketplace — §7.
 *
 * Saving this re-derives `products.facets`, which is what the storefront's
 * filters actually match on. It is the only section with that side effect, and
 * `saveClassificationAction` exists separately from the generic section saver
 * because of it.
 *
 * ## Two kinds of control, on purpose
 *
 * Categories and Industries are searchable multi-selects; Technologies stays a
 * checkbox list.
 *
 * This reverses the note that used to be here — "a plain list works inside a
 * `<form>` with no JavaScript at all; a searchable multi-select would be more code
 * and less reliable". The first half is still true. What it did not know is that
 * **adding a search box to an uncontrolled checkbox list is a data-loss bug**: a
 * box hidden by the filter unmounts, submits nothing, and the save writes an empty
 * array over selections the person can no longer see. So there was never a version
 * of "search over the existing control"; the selection had to leave the DOM, and
 * once it has, `MultiSelect` is also immune to the form-reset bug that was wiping
 * these very fields (see `section-form.tsx`).
 *
 * Technologies keeps the list because the trade genuinely differs: it is a
 * developer's filter with a short vocabulary, usually several ticked at once, and
 * scanning it is faster than searching it.
 *
 * `action` is a prop so this form serves both wizard surfaces — vendor ticket 04.
 * Defaulted to the staff action, so every existing caller is unchanged and the
 * vendor pages pass their own. A second copy of the form per surface is how one of
 * them quietly stops having a field the other has.
 */
export function ClassificationForm({
  product,
  options,
  nextHref,
  reviewHref,
  action = saveClassificationAction,
}: {
  product: AdminProductView;
  options: Record<TaxonomyKind, TaxonomyOption[]>;
  nextHref: string;
  /**
   * The review step, for the signpost below the catalogue control.
   *
   * A resolved **string**, not a callback: `stepHref` needs the surface
   * (`admin` or `vendor`), the page knows it and this component does not, and a
   * function cannot cross into a client component.
   */
  reviewHref: Route;
  action?: SectionFormProps["action"];
}) {
  /*
   * Held in state so the vocabulary below swaps the moment the catalogue changes,
   * rather than after a save that would have been refused anyway.
   *
   * The server is still the authority: `saveClassification` refuses a term from
   * the other catalogue. This is what stops the editor being offered one.
   */
  const [catalogue, setCatalogue] = useState<ProductCatalogue>(product.catalogue ?? "script");

  const inCatalogue = (option: TaxonomyOption) =>
    option.catalogue === "both" || option.catalogue === catalogue;

  const categoryOptions = asTree(options.category.filter(inCatalogue));

  /*
   * Mirrored out of `MultiSelect` so the primary picker can depend on it.
   *
   * The control keeps its own state — this is a copy that follows it, never an
   * input to it. Seeded from the product so the row is right on first render,
   * before anything has been toggled.
   */
  const [chosenCategories, setChosenCategories] = useState<readonly string[]>(
    product.categoryIds,
  );

  return (
    <SectionForm action={action} productId={product.id} nextHref={nextHref}>
      <Field label="Catalogue" hint="Categories list also varies based on this catalogue">
        {/*
          `NativeSelect`, not the Radix one — see its docblock. This control was
          the clearest demonstration of the problem: Radix answers React's
          pre-action form reset by calling `onValueChange` with the value it saw at
          first render, so saving snapped the catalogue back and swapped the whole
          vocabulary underneath the boxes that had just been ticked.
        */}
        <NativeSelect
          name="catalogue"
          value={catalogue}
          onChange={(event) => setCatalogue(event.target.value as ProductCatalogue)}
          containerClassName="w-full sm:w-[280px]"
        >
          <option value="script">Application script</option>
          <option value="template">Website template</option>
        </NativeSelect>
      </Field>

      <FieldGroup
        title="Categories"
        description="What kind of software this is. Shown as a filter and as a landing page."
      >
        <MultiSelect
          name="categoryIds"
          label="Categories"
          options={categoryOptions}
          defaultSelected={product.categoryIds}
          onSelectedChange={setChosenCategories}
        />

        <PrimaryCategory
          options={categoryOptions}
          chosen={chosenCategories}
          current={product.primaryCategoryId}
        />
      </FieldGroup>

      <FieldGroup
        title="Industries"
        description="Who it is for. A business owner filters by this before anything technical."
      >
        <MultiSelect
          name="industryIds"
          label="Industries"
          options={options.industry.filter(inCatalogue)}
          defaultSelected={product.industryIds}
        />
      </FieldGroup>

      <FieldGroup
        title="Technologies"
        description="What it is built with. A developer's filter, not a buyer's."
      >
        <MultiSelect
          name="technologyIds"
          label="Technologies"
          options={options.technology.filter(inCatalogue)}
          defaultSelected={product.technologyIds}
        />
      </FieldGroup>

      <Field
        label="Product type"
        hint="One only, and it says what kind of thing this is *within* its catalogue — not which catalogue it is in."
      >
        <NativeSelect
          name="productTypeId"
          defaultValue={product.productTypeId ?? ""}
          containerClassName="w-full sm:w-[280px]"
        >
          {/*
            A real option for "none", which is what makes the "(optional)" label
            true. Radix reserves `value=""`, so there was no way to express it: the
            field could not be left alone on a fresh draft, and once set it could
            not be cleared. `saveClassification` already routes an absent value to
            `$unset`, so nothing on the server had to change.
          */}
          <option value="">No specific type</option>
          {options.product_type.filter(inCatalogue).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </SectionForm>
  );
}

/**
 * Which of the chosen categories the product actually belongs to.
 *
 * ## It appears only when there is a decision to make
 *
 * With one category selected there is nothing to choose, so no control renders —
 * 1,009 of 1,010 products carry exactly one, so almost nobody ever sees this. The
 * defaulting rule lives in `classificationWithPrimary`, which is the one place
 * that can be tested and the one place the server trusts; rendering a hidden input
 * here to say the same thing would be a second copy of it, free to drift.
 *
 * Unmounting the row when the count drops back to one is therefore **not** the
 * data-loss shape the docblocks above warn about. An absent field means "the
 * server decides", and with one category there is only one answer.
 *
 * ## Native radios
 *
 * `SectionForm` dispatches by hand, so React's pre-action `form.reset()` never
 * fires here and a Radix control would in fact be safe. There is still no
 * `RadioGroup` in `components/ui`, and adding one to ship five radios is a new
 * dependency surface for no gain — the same argument the `NativeSelect` above
 * makes.
 */
function PrimaryCategory({
  options,
  chosen,
  current,
}: {
  options: readonly TaxonomyOption[];
  chosen: readonly string[];
  current?: string;
}) {
  // The same intersection `MultiSelect` applies, so flipping the catalogue drops
  // a term from the chips and from here together rather than leaving a radio for
  // something no longer selected. Order follows `options`, so the radios read in
  // the same sequence as the list above.
  const picked = options.filter((option) => chosen.includes(option.id));
  if (picked.length < 2) return null;

  const checked =
    current && picked.some((option) => option.id === current) ? current : picked[0]!.id;

  return (
    <fieldset className="border-border mt-3 rounded-lg border px-3 pt-2 pb-2.5">
      <legend className="text-subtle px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
        Primary category
      </legend>
      <p className="text-muted-foreground mb-1.5 text-[12.5px]">
        The one this is filed under — it decides the breadcrumb and the page&rsquo;s address.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {picked.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-[13.5px]">
            <input
              type="radio"
              name="primaryCategoryId"
              value={option.id}
              defaultChecked={option.id === checked}
              className="accent-[var(--signal)]"
            />
            {option.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
