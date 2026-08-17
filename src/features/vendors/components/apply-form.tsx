"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, SectionForm } from "@/features/products/components/section-form";
import { applyAction } from "../actions";

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

        <Field label="Country" htmlFor="country" hint="Two-letter code — GB, US, NG." required>
          <Input
            id="country"
            name="country"
            required
            maxLength={2}
            defaultValue="GB"
            autoComplete="country"
            className="max-w-24 uppercase"
          />
        </Field>
      </FieldGroup>

      <FieldGroup
        title="What you build"
        description="A couple of paragraphs. This is the substance of the application — it is what somebody reads when they decide."
      >
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

      <FieldGroup title="The agreement">
        <div className="flex items-start gap-2.5">
          {/* The version is decided server-side. A client that could name it could
              accept an older one. */}
          <Checkbox id="acceptAgreement" name="acceptAgreement" required />
          <label htmlFor="acceptAgreement" className="text-[13px] leading-relaxed">
            I accept the Innovatrix vendor agreement{" "}
            <span className="text-subtle font-mono text-[11px]">({agreementVersion})</span>, and
            I confirm I own or am licensed to distribute everything I list.
          </label>
        </div>
      </FieldGroup>
    </SectionForm>
  );
}
