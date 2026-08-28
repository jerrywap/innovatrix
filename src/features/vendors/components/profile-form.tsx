"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, SectionForm } from "@/features/products/components/section-form";
import { BrandImageUpload } from "./brand-image-upload";
import { saveProfileAction } from "../actions";

/**
 * The vendor's public-facing details.
 *
 * The **slug is shown and not editable**, which is worth doing rather than
 * hiding: it is the storefront address, so a vendor should be able to see it, and
 * they should be able to see that it will not change under them. Vendor ticket 11
 * puts it in the sitemap and vendor ticket 04 denormalises it onto every product
 * for the `vend:` facet, so a rename means dead URLs and a bulk re-derive.
 */
export function ProfileForm({
  defaults,
  slug,
}: {
  defaults: {
    displayName: string;
    contactEmail: string;
    summary: string;
    supportEmail: string;
    websiteUrl: string;
    coverUrl: string;
    logoUrl: string;
  };
  slug: string;
}) {
  return (
    <SectionForm action={saveProfileAction}>
      <FieldGroup title="Your details">
        <Field label="Display name" htmlFor="displayName" required>
          <Input
            id="displayName"
            name="displayName"
            required
            maxLength={80}
            defaultValue={defaults.displayName}
          />
        </Field>

        <Field
          label="Storefront address"
          htmlFor="slug-display"
          hint="Fixed once you're verified — customers and search engines have it."
        >
          <Input id="slug-display" value={`/vendors/${slug}`} readOnly disabled />
        </Field>

        <Field label="Contact email" htmlFor="contactEmail" required>
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            required
            defaultValue={defaults.contactEmail}
          />
        </Field>
      </FieldGroup>

      <FieldGroup
        title="Your storefront"
        description="What a customer reads when they wonder who made this."
      >
        {/*
          Artwork first, then words.

          Not decoration-before-substance: the storefront draws them in this
          order, and a settings screen that reorders the thing it configures is a
          screen somebody has to translate. `Field`'s label is `htmlFor`-less here
          because the control is a dropzone rather than one input — `FileDropzone`
          labels its own trigger.
        */}
        <Field label="Cover image" hint="Sits behind your name at the top of your storefront.">
          <BrandImageUpload
            kind="cover"
            name="coverUrl"
            defaultValue={defaults.coverUrl}
            alt="Your storefront cover image"
          />
        </Field>

        <Field
          label="Logo"
          hint="Shown on your storefront and beside your name on every product."
        >
          <BrandImageUpload
            kind="logo"
            name="logoUrl"
            defaultValue={defaults.logoUrl}
            alt="Your logo"
          />
        </Field>

        <Field
          label="Summary"
          htmlFor="summary"
          hint="A paragraph. What you build, and for whom."
        >
          <Textarea
            id="summary"
            name="summary"
            rows={4}
            maxLength={600}
            defaultValue={defaults.summary}
          />
        </Field>

        <Field label="Website" htmlFor="websiteUrl" hint="Include https://">
          <Input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            placeholder="https://"
            defaultValue={defaults.websiteUrl}
          />
        </Field>

        <Field
          label="Support email"
          htmlFor="supportEmail"
          hint="Where customers of your products should write."
        >
          <Input
            id="supportEmail"
            name="supportEmail"
            type="email"
            defaultValue={defaults.supportEmail}
          />
        </Field>
      </FieldGroup>
    </SectionForm>
  );
}
