"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, SectionForm, type SectionFormProps } from "./section-form";
import { enhanceProseAction, saveSeoAction } from "../actions";
import { EnhanceButton } from "./enhance-button";
import { CompareProseDialog } from "./compare-dialog";
import type { AdminProductView } from "@/services/catalog/product-view";

/** The caps `productSeoSchema` enforces — shown in the modal so a long reply is visible. */
const LIMITS = { seoTitle: 70, seoDescription: 160 } as const;

/**
 * How the product appears in search results and shared links — §93.
 *
 * Every field is optional, and the placeholders show what gets used instead:
 * the name and summary already say the right thing for most products, and a
 * meta description that merely repeats the summary is work for no gain. This
 * step exists for the handful where the marketing wording should differ from
 * the product wording.
 *
 * The lengths are the real ones Google truncates at — 60ish for a title, 155ish
 * for a description — rather than round numbers.
 *
 * `action` is a prop so this form serves both wizard surfaces — vendor ticket 04.
 * Defaulted to the staff action, so every existing caller is unchanged and the
 * vendor pages pass their own. A second copy of the form per surface is how one of
 * them quietly stops having a field the other has.
 */
export function SeoForm({
  product,
  nextHref,
  action = saveSeoAction,
  enhance = enhanceProseAction,
  aiUnavailable,
}: {
  product: AdminProductView;
  nextHref: string;
  action?: SectionFormProps["action"];
  /** The surface's own rewrite action — the staff one refuses a vendor. */
  enhance?: typeof enhanceProseAction;
  aiUnavailable?: string;
}) {
  /*
   * Both fields are controlled here, unlike the rest of this wizard, because a
   * rewrite has to be able to replace them — the same reason the summary on the
   * basics step is.
   *
   * The context comes from the **saved product**, not from this form: the SEO
   * step carries no name and no summary, and those two are exactly what a search
   * title and a meta description should be derived from. It is also what the
   * placeholders already promise as the fallback, so the model is being asked to
   * beat the same thing the field would otherwise use.
   */
  const [title, setTitle] = useState(product.seo.title ?? "");
  const [description, setDescription] = useState(product.seo.description ?? "");
  const [compare, setCompare] = useState<null | {
    field: "seoTitle" | "seoDescription";
    mine: string;
    suggested: string;
  }>(null);

  const context = { name: product.name, summary: product.summary };

  return (
    <SectionForm action={action} productId={product.id} nextHref={nextHref}>
      <FieldGroup
        title="Search and sharing"
        description="Leave blank to use the product's own name and summary."
      >
        <Field
          label="Title"
          htmlFor="seo-title"
          hint="Around 60 characters before search results cut it off."
          action={
            <EnhanceButton
              label="Write a title"
              {...(aiUnavailable ? { disabledReason: aiUnavailable } : {})}
              run={() => enhance({ field: "seoTitle", text: title, ...context })}
              onResult={({ text }) =>
                setCompare({ field: "seoTitle", mine: title, suggested: text })
              }
            />
          }
        >
          <Input
            id="seo-title"
            name="seo[title]"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={70}
            placeholder={product.name}
          />
        </Field>

        <Field
          label="Description"
          htmlFor="seo-description"
          hint="Around 155 characters. This is the sentence under the link."
          action={
            <EnhanceButton
              label="Write a description"
              {...(aiUnavailable ? { disabledReason: aiUnavailable } : {})}
              run={() => enhance({ field: "seoDescription", text: description, ...context })}
              onResult={({ text }) =>
                setCompare({ field: "seoDescription", mine: description, suggested: text })
              }
            />
          }
        >
          <Textarea
            id="seo-description"
            name="seo[description]"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={160}
            rows={2}
            placeholder={product.summary}
          />
        </Field>

        <Field
          label="Share image"
          htmlFor="seo-og"
          hint="Shown when the page is pasted into Slack or a message. Falls back to the first screenshot."
        >
          <Input
            id="seo-og"
            name="seo[ogImageUrl]"
            type="url"
            defaultValue={product.seo.ogImageUrl ?? ""}
            placeholder="https://…"
            className="font-mono text-[12.5px]"
          />
        </Field>
      </FieldGroup>

      {compare && (
        <CompareProseDialog
          open
          onOpenChange={(next) => !next && setCompare(null)}
          title={
            compare.field === "seoTitle"
              ? "Suggested search title"
              : "Suggested meta description"
          }
          mine={compare.mine}
          suggested={compare.suggested}
          limit={LIMITS[compare.field]}
          onMineChange={(mine) => setCompare({ ...compare, mine })}
          onSuggestedChange={(suggested) => setCompare({ ...compare, suggested })}
          onAccept={(value) => {
            /*
              Taken as written. The dialog refuses to hand over a side that is
              over the limit, so this cannot receive one — and trimming it here
              would cut mid-word, which is the thing that refusal exists to avoid.
            */
            if (compare.field === "seoTitle") setTitle(value);
            else setDescription(value);
            setCompare(null);
          }}
        />
      )}
    </SectionForm>
  );
}
