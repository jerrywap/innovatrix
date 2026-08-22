"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
 * Checkbox lists rather than a combobox: there are tens of taxonomies, not
 * hundreds, and a plain list works inside a `<form>` with no JavaScript at all.
 * A searchable multi-select would be more code and less reliable.
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
      <Field
        label="Catalogue"
        hint="Templates are browsed at /templates and never appear in script search. Changing this changes which categories are available."
      >
        <Select
          name="catalogue"
          value={catalogue}
          onValueChange={(value) => setCatalogue(value as ProductCatalogue)}
        >
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="script">Application script</SelectItem>
            <SelectItem value="template">Website template</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {/*
        A signpost, not the control.

        Creating the second listing lives on the **review** step, because by then
        there is a price, media and licence packages to copy — at step two of eleven
        there would be nothing, and the sibling would arrive empty. But this is
        where somebody choosing between "script" and "template" thinks of it, so the
        pointer belongs here.

        Worded as *where*, not *whether*: it is accurate whether or not this product
        already has a template listing, which this form has no way to know without a
        query it does not otherwise need.
      */}
      {catalogue === "script" && (
        <p className="text-subtle -mt-1 text-[12.5px]">
          Selling the front-end on its own too?{" "}
          <Link href={reviewHref} className="underline underline-offset-2">
            That&rsquo;s on the Review step
          </Link>
          .
        </p>
      )}

      <FieldGroup
        title="Categories"
        description="What kind of software this is. Shown as a filter and as a landing page."
      >
        <CheckboxList
          name="categoryIds"
          options={options.category.filter(inCatalogue)}
          selected={product.categoryIds}
        />
      </FieldGroup>

      <FieldGroup
        title="Industries"
        description="Who it is for. A business owner filters by this before anything technical."
      >
        <CheckboxList
          name="industryIds"
          options={options.industry.filter(inCatalogue)}
          selected={product.industryIds}
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
        <Select name="productTypeId" defaultValue={product.productTypeId ?? ""}>
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue placeholder="Choose a type" />
          </SelectTrigger>
          <SelectContent>
            {options.product_type.filter(inCatalogue).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
