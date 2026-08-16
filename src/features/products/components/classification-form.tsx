"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldGroup, SectionForm } from "./section-form";
import { saveClassificationAction } from "../actions";
import type { AdminProductView } from "@/services/catalog/product-view";
import type { TaxonomyKind } from "@/lib/db/enums";

export interface TaxonomyOption {
  id: string;
  name: string;
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
 */
export function ClassificationForm({
  product,
  options,
  nextHref,
}: {
  product: AdminProductView;
  options: Record<TaxonomyKind, TaxonomyOption[]>;
  nextHref: string;
}) {
  return (
    <SectionForm action={saveClassificationAction} productId={product.id} nextHref={nextHref}>
      <FieldGroup
        title="Categories"
        description="What kind of software this is. Shown as a filter and as a landing page."
      >
        <CheckboxList
          name="categoryIds"
          options={options.category}
          selected={product.categoryIds}
        />
      </FieldGroup>

      <FieldGroup
        title="Industries"
        description="Who it is for. A business owner filters by this before anything technical."
      >
        <CheckboxList
          name="industryIds"
          options={options.industry}
          selected={product.industryIds}
        />
      </FieldGroup>

      <FieldGroup
        title="Technologies"
        description="What it is built with. A developer's filter, not a buyer's."
      >
        <CheckboxList
          name="technologyIds"
          options={options.technology}
          selected={product.technologyIds}
        />
      </FieldGroup>

      <Field
        label="Product type"
        hint="One only — a product is a complete application or a script, not both."
      >
        <Select name="productTypeId" defaultValue={product.productTypeId ?? ""}>
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue placeholder="Choose a type" />
          </SelectTrigger>
          <SelectContent>
            {options.product_type.map((option) => (
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
