"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, SectionForm } from "./section-form";
import { saveSeoAction } from "../actions";
import type { AdminProductView } from "@/services/catalog/product-view";

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
 */
export function SeoForm({
  product,
  nextHref,
}: {
  product: AdminProductView;
  nextHref: string;
}) {
  return (
    <SectionForm action={saveSeoAction} productId={product.id} nextHref={nextHref}>
      <FieldGroup
        title="Search and sharing"
        description="Leave blank to use the product's own name and summary."
      >
        <Field
          label="Title"
          htmlFor="seo-title"
          hint="Around 60 characters before search results cut it off."
        >
          <Input
            id="seo-title"
            name="seo[title]"
            defaultValue={product.seo.title ?? ""}
            maxLength={70}
            placeholder={product.name}
          />
        </Field>

        <Field
          label="Description"
          htmlFor="seo-description"
          hint="Around 155 characters. This is the sentence under the link."
        >
          <Textarea
            id="seo-description"
            name="seo[description]"
            defaultValue={product.seo.description ?? ""}
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
    </SectionForm>
  );
}
