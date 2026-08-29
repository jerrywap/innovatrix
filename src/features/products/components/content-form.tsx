"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, SectionForm, type SectionFormProps } from "./section-form";
import { Repeater } from "./repeater";
import { proposeFeaturesAction, saveContentAction } from "../actions";
import { EnhanceButton } from "./enhance-button";
import { CompareFeaturesDialog, type Feature } from "./compare-dialog";
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
  propose = proposeFeaturesAction,
  aiUnavailable,
}: {
  product: AdminProductView;
  nextHref: string;
  action?: SectionFormProps["action"];
  /** The surface's own proposal action — the staff one refuses a vendor. */
  propose?: typeof proposeFeaturesAction;
  aiUnavailable?: string;
}) {
  /*
   * The accepted list, and a counter that remounts the repeater.
   *
   * `Repeater` seeds its rows from `initial` once and holds them in local state
   * with uncontrolled inputs — there is no way for a parent to push new rows in.
   * Making it controlled would touch content, media, pricing and demo; changing
   * its `key` replaces it wholesale and is local to the one step that needs it.
   *
   * The cost is honest and worth stating: remounting discards anything typed into
   * the rows since the last accept. That only happens when the author has just
   * chosen to replace the whole list, which is the moment those edits were being
   * discarded anyway.
   */
  const [features, setFeatures] = useState<Feature[]>(product.features);
  const [generation, setGeneration] = useState(0);
  const [compare, setCompare] = useState<null | { mine: Feature[]; suggested: Feature[] }>(
    null,
  );

  return (
    <SectionForm action={action} productId={product.id} nextHref={nextHref}>
      <FieldGroup
        title="Features"
        description="What it does, one line each. These appear as a list on the product page."
      >
        <div className="flex justify-end">
          <EnhanceButton
            label="Generate features"
            {...(aiUnavailable ? { disabledReason: aiUnavailable } : {})}
            /*
              The proposal reads the *saved* product — its name, summary,
              description and taxonomy — not this form, which carries none of
              them. `existing` is what is on screen, so a regeneration knows what
              the author has already written and can keep the good lines.
            */
            run={() => propose({ productId: product.id, existing: features })}
            onResult={({ features: suggested }) => setCompare({ mine: features, suggested })}
          />
        </div>

        <Repeater
          key={generation}
          initial={features}
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

      {compare && (
        <CompareFeaturesDialog
          open
          onOpenChange={(next) => !next && setCompare(null)}
          mine={compare.mine}
          suggested={compare.suggested}
          onMineChange={(mine) => setCompare({ ...compare, mine })}
          onSuggestedChange={(suggested) => setCompare({ ...compare, suggested })}
          onAccept={(chosen) => {
            // Blank rows are how an empty "Add a feature" leaves the dialog; the
            // form would refuse them on save, which is a worse place to find out.
            setFeatures(chosen.filter((feature) => feature.title.trim()));
            setGeneration((n) => n + 1);
            setCompare(null);
          }}
        />
      )}
    </SectionForm>
  );
}
