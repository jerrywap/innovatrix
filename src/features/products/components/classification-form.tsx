"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Checkbox } from "@/components/ui/checkbox";
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
          options={options.category.filter(inCatalogue)}
          defaultSelected={product.categoryIds}
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
        <CheckboxList
          name="technologyIds"
          options={options.technology.filter(inCatalogue)}
          selected={product.technologyIds}
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

function CheckboxList({
  name,
  options,
  selected,
}: {
  name: string;
  options: readonly TaxonomyOption[];
  selected: readonly string[];
}) {
  const chosen = new Set(selected);

  if (options.length === 0) {
    return (
      <p className="text-subtle text-[13px]">None defined yet — add some under Taxonomies.</p>
    );
  }

  return (
    <div className="border-border bg-surface grid max-h-[220px] gap-1 overflow-y-auto rounded-xl border p-2 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option.id}
          className="hover:bg-surface-muted flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px]"
        >
          <Checkbox name={name} value={option.id} defaultChecked={chosen.has(option.id)} />
          {option.name}
        </label>
      ))}
    </div>
  );
}
