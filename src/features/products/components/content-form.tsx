"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, SectionForm, type SectionFormProps } from "./section-form";
import { Repeater } from "./repeater";
import { saveContentAction } from "../actions";
import type { AdminProductView } from "@/services/catalog/product-view";

/**
 * Features and requirements — §42 steps 3 and 4, merged.
 *
 * They are two sections in the spec and one decision in practice: both answer
 * "what is this thing", and splitting them meant a step with a single textarea.
 *
 * Features are **structured**, not prose. The product page renders them as a
 * list, and ticket 17's assistant reads them to ask sensible opening questions
 * — neither of which works against a paragraph.
 *
 * `action` is a prop so this form serves both wizard surfaces — vendor ticket 04.
 * Defaulted to the staff action, so every existing caller is unchanged and the
 * vendor pages pass their own. A second copy of the form per surface is how one of
 * them quietly stops having a field the other has.
 */
export function ContentForm({
  product,
  nextHref,
  action = saveContentAction,
}: {
  product: AdminProductView;
  nextHref: string;
  action?: SectionFormProps["action"];
}) {
  return (
    <SectionForm action={action} productId={product.id} nextHref={nextHref}>
      <FieldGroup
        title="Features"
        description="What it does, one line each. These appear as a list on the product page."
      >
        <Repeater
          initial={product.features}
          blank={() => ({ title: "", detail: undefined })}
          addLabel="Add a feature"
          emptyLabel="No features listed yet."
          max={60}
          reorderable
          row={(feature, index) => (
            <div className="flex flex-col gap-2">
              <Input
                name={`features[${index}][title]`}
                defaultValue={feature.title}
                placeholder="Role-based access"
                maxLength={120}
                required
                aria-label={`Feature ${index + 1} title`}
              />
              <Input
                name={`features[${index}][detail]`}
                defaultValue={feature.detail ?? ""}
                placeholder="Optional — one sentence of detail"
                maxLength={500}
                aria-label={`Feature ${index + 1} detail`}
                className="text-[13px]"
              />
            </div>
          )}
        />
      </FieldGroup>

      <Field
        label="Requirements"
        htmlFor="product-requirements"
        hint="PHP 8.3+, PostgreSQL 15+, Node 20+. Plain text — it renders under the technical section, where a non-technical reader will not meet it."
      >
        <Textarea
          id="product-requirements"
          name="requirements"
          defaultValue={product.requirements ?? ""}
          rows={5}
          maxLength={4000}
          className="font-mono text-[13px]"
        />
      </Field>
    </SectionForm>
  );
}
