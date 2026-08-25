"use client";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { COUNTRIES, countryLabel } from "@/lib/countries";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, SectionForm } from "@/features/products/components/section-form";
import { applyAction } from "../actions";
import { AgreementGate } from "./agreement-gate";

/**
 * The vendor application — vendor ticket 01.
 *
 * Reuses the wizard's `SectionForm`, which already owns submission state, field
 * errors and the submit pair. This form has one button rather than two because
 * there is nowhere to continue to, which `SectionForm` handles by omitting
 * `nextHref`.
 *
 * ## What is not asked for
 *
 * No team, no seats, no "invite your colleagues". A vendor is usually one person
 * and the common case must not walk through the rare one — the owner membership is
 * created with the vendor, so a solo vendor is never a special case downstream.
 *
 * No slug either. It is derived from the display name and suffixed on collision:
 * the storefront address is not the thing somebody came here to choose, and asking
 * them to pick one they cannot later change is a decision made at the worst moment.
 */
export function ApplyForm({
  defaultEmail,
  agreementVersion,
}: {
  defaultEmail: string;
  agreementVersion: string;
}) {
  return (
    <SectionForm action={applyAction}>
      <FieldGroup
        title="Who you are"
        description="This is what customers see beside your products."
      >
        <Field label="Display name" htmlFor="displayName" required>
          <Input
            id="displayName"
            name="displayName"
            required
            maxLength={80}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Contact email"
          htmlFor="contactEmail"
          hint="How we reach you about your application and your products."
          required
        >
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            required
            defaultValue={defaultEmail}
            autoComplete="email"
          />
        </Field>

        <Field
          label="Country"
          htmlFor="country"
          hint="Where you are based. It decides which tax and payout rules apply to you."
          required
        >
          {/*
            A real list, not a two-letter box. The value posted is unchanged —
            ISO 3166-1 alpha-2, which is what `countrySchema` already validates —
            so this is a control change with no server change behind it.

            `NativeSelect` rather than the Radix one: a native <select> gives the
            platform's own long-list behaviour (type-ahead on a phone, a scroll
            wheel on iOS) for 249 options, and it is immune to the pre-action
            form reset that `section-form.tsx` documents.
          */}
          <NativeSelect
            id="country"
            name="country"
            required
            defaultValue="GB"
            autoComplete="country"
            containerClassName="max-w-sm"
          >
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {countryLabel(country)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>

      <FieldGroup title="What you build" description="A couple of paragraphs.">
        <Field label="Your work" htmlFor="pitch" required>
          <Textarea id="pitch" name="pitch" required rows={6} minLength={40} maxLength={2000} />
        </Field>

        <Field label="Website" htmlFor="websiteUrl" hint="Include https://">
          <Input id="websiteUrl" name="websiteUrl" type="url" placeholder="https://" />
        </Field>

        <Field
          label="Support email"
          htmlFor="supportEmail"
          hint="Where customers of your products should write. Defaults to your contact email."
        >
          <Input id="supportEmail" name="supportEmail" type="email" />
        </Field>
      </FieldGroup>

      <FieldGroup
        title="The agreement"
        description="Read it through — the accept button at the end of it unlocks once you have."
      >
        {/* The version is decided server-side. A client that could name it could
            accept an older one. */}
        <AgreementGate name="acceptAgreement" version={agreementVersion} />
      </FieldGroup>
    </SectionForm>
  );
}
