"use client";

import { ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, SectionForm, type SectionFormProps } from "./section-form";
import { Repeater } from "./repeater";
import { saveDemoAction } from "../actions";
import { DEMO_EXPOSURES } from "@/lib/db/enums";
import type { AdminProductView } from "@/services/catalog/product-view";

type CredentialRow = AdminProductView["demo"]["credentialRoles"][number];

const EXPOSURE_COPY: Record<string, { label: string; hint: string }> = {
  public: {
    label: "Anyone",
    hint: "Shown on the product page to visitors who are not signed in. Search engines will index it.",
  },
  authenticated: {
    label: "Signed-in visitors",
    hint: "Anyone with an account can see the credentials. The usual choice.",
  },
  owners_only: {
    label: "Customers who own this product",
    hint: "Nobody else's browser ever receives them — not hidden, absent.",
  },
};

/**
 * Demo configuration — §9, §89.
 *
 * ## The password field is always empty, and that is not a bug
 *
 * There is nothing to pre-fill it with. The stored value is ciphertext, and the
 * only way to show the plaintext would be to decrypt it and send it to this
 * browser on every page load — which would defeat the encryption for the sake
 * of a convenience nobody asked for.
 *
 * So blank means **keep the stored password**, matched by role, and the hint
 * says so. The alternative reading — blank means clear — would wipe every other
 * credential the moment somebody fixed a typo in one row's label, silently.
 *
 * ## The warning is a warning, not decoration
 *
 * §9 requires it explicitly. Demo credentials get pasted into a product page
 * and, at `public` exposure, indexed by Google. A production password entered
 * here is a production breach, and the person most likely to do it is someone
 * moving quickly through a form that did not say anything.
 */
export function DemoForm({
  product,
  nextHref,
  action = saveDemoAction,
}: {
  product: AdminProductView;
  nextHref: string;
  action?: SectionFormProps["action"];
}) {
  return (
    <SectionForm action={action} productId={product.id} nextHref={nextHref}>
      <div
        role="note"
        className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3.5 py-3"
      >
        <ShieldAlert
          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
        <p className="text-[12.5px] leading-relaxed">
          <strong className="font-medium">Never enter production credentials here.</strong>{" "}
          These are for a throwaway demo environment. Depending on the exposure setting below
          they may be shown to anyone with an account — or to the public, where search engines
          will index them.
        </p>
      </div>

      <FieldGroup title="Demo environment" description="Where a customer can try the product.">
        <Field
          label="Public demo"
          htmlFor="demo-public"
          hint="Shown to everyone, no sign-in. Leave blank if there isn't one."
        >
          <Input
            id="demo-public"
            name="demo[publicUrl]"
            type="url"
            defaultValue={product.demo.publicUrl ?? ""}
            placeholder="https://demo.example.com"
            className="font-mono text-[12.5px]"
          />
        </Field>

        <Field
          label="Customer view"
          htmlFor="demo-customer"
          hint="The end-user side of the demo."
        >
          <Input
            id="demo-customer"
            name="demo[customerUrl]"
            type="url"
            defaultValue={product.demo.customerUrl ?? ""}
            placeholder="https://demo.example.com/app"
            className="font-mono text-[12.5px]"
          />
        </Field>

        <Field label="Admin view" htmlFor="demo-admin" hint="The back office of the demo.">
          <Input
            id="demo-admin"
            name="demo[adminUrl]"
            type="url"
            defaultValue={product.demo.adminUrl ?? ""}
            placeholder="https://demo.example.com/admin"
            className="font-mono text-[12.5px]"
          />
        </Field>
      </FieldGroup>

      <FieldGroup
        title="Who may see the credentials"
        description="This decides what reaches a visitor's browser, not just what is drawn on screen."
      >
        <div className="flex flex-col gap-2">
          {DEMO_EXPOSURES.map((exposure) => {
            const copy = EXPOSURE_COPY[exposure];
            return (
              <label
                key={exposure}
                className="border-border bg-surface flex items-start gap-3 rounded-xl border p-3"
              >
                <input
                  type="radio"
                  name="demo[exposure]"
                  value={exposure}
                  defaultChecked={product.demo.exposure === exposure}
                  className="mt-1 accent-[var(--signal)]"
                />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium">
                    {copy?.label ?? exposure}
                  </span>
                  <span className="text-muted-foreground block text-[12.5px]">
                    {copy?.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </FieldGroup>

      <FieldGroup
        title="Credentials"
        description="One row per role. Passwords are encrypted before they are stored."
      >
        <Repeater
          initial={product.demo.credentialRoles}
          blank={blankCredential}
          addLabel="Add a role"
          emptyLabel="No demo credentials yet."
          max={10}
          row={(credential, index) => <CredentialRow row={credential} index={index} />}
        />
      </FieldGroup>

      <FieldGroup
        title="Notes"
        description="Anything a customer needs to know before they click through."
      >
        <Field label="Instructions" htmlFor="demo-instructions">
          <Textarea
            id="demo-instructions"
            name="demo[instructions]"
            defaultValue={product.demo.instructions ?? ""}
            maxLength={2000}
            rows={3}
            placeholder="Sign in as the administrator to see the reporting module."
          />
        </Field>

        <Field
          label="Reset schedule"
          htmlFor="demo-reset"
          hint="Informational — nothing acts on it yet."
        >
          <Input
            id="demo-reset"
            name="demo[resetSchedule]"
            defaultValue={product.demo.resetSchedule ?? ""}
            maxLength={200}
            placeholder="Data resets nightly at 02:00 UTC"
            className="sm:w-[340px]"
          />
        </Field>
      </FieldGroup>
    </SectionForm>
  );
}

function CredentialRow({ row, index }: { row: CredentialRow; index: number }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input
        name={`demo[credentials][${index}][role]`}
        defaultValue={row.role}
        placeholder="Administrator"
        maxLength={60}
        aria-label={`Credential ${index + 1} role`}
        required
      />
      <Input
        name={`demo[credentials][${index}][label]`}
        defaultValue={row.label ?? ""}
        placeholder="Full access"
        maxLength={80}
        aria-label={`Credential ${index + 1} label`}
      />
      <Input
        name={`demo[credentials][${index}][username]`}
        defaultValue={row.username ?? ""}
        placeholder="admin@demo.test"
        maxLength={160}
        autoComplete="off"
        aria-label={`Credential ${index + 1} username`}
        className="font-mono text-[12.5px]"
      />
      <div className="flex flex-col gap-1">
        <Input
          name={`demo[credentials][${index}][password]`}
          type="password"
          placeholder={row.hasPassword ? "•••••••• (unchanged)" : "Set a password"}
          maxLength={200}
          // A password manager offering to fill a *demo* credential field is
          // how a real password ends up in one.
          autoComplete="new-password"
          aria-label={`Credential ${index + 1} password`}
          className="font-mono text-[12.5px]"
        />
        <span className="text-subtle text-[11.5px]">
          {row.hasPassword
            ? "A password is stored. Leave blank to keep it."
            : "Encrypted before it is saved."}
        </span>
      </div>
    </div>
  );
}

function blankCredential(): CredentialRow {
  return { role: "", hasPassword: false };
}
