"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { changeSlugAction, saveBasicsAction } from "../actions";
import {
  Field,
  FieldGroup,
  FormErrors,
  SectionForm,
  type SectionFormProps,
} from "./section-form";
import { RichTextEditor } from "./rich-text-editor";
import type { AdminProductView } from "@/services/catalog/product-view";

/**
 * Name, summary and description — §42 step 1.
 *
 * `action` is a prop so this form serves both wizard surfaces (vendor ticket 04),
 * defaulted to the staff action so existing callers are unchanged.
 *
 * `canChangeSlug` is separate and defaults to **true** for staff. A vendor does not
 * get it: the slug is the product's public address, `slugHistory` is what keeps old
 * links alive, and retiring an address is a decision about the marketplace rather
 * than about one listing. Nothing is lost — a vendor who needs it asks, and a staff
 * member does it on the admin surface.
 */
export function BasicsForm({
  product,
  nextHref,
  action = saveBasicsAction,
  canChangeSlug = true,
}: {
  product: AdminProductView;
  nextHref: string;
  action?: SectionFormProps["action"];
  canChangeSlug?: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <SectionForm action={action} productId={product.id} nextHref={nextHref}>
        <Field label="Name" htmlFor="product-name" required>
          <Input
            id="product-name"
            name="name"
            defaultValue={product.name}
            required
            minLength={2}
            maxLength={120}
          />
        </Field>

        <Field
          label="Summary"
          htmlFor="product-summary"
          required
          hint="One line, on every marketplace card. Write it for someone skimming."
        >
          <Textarea
            id="product-summary"
            name="summary"
            defaultValue={product.summary}
            required
            minLength={10}
            maxLength={300}
            rows={2}
          />
        </Field>

        <Field
          label="Description"
          required
          hint="Lead with what it does for a business. The technical detail has its own section on the product page — a reader who does not want it should not have to wade through it."
        >
          <RichTextEditor name="description" defaultValue={product.description} />
        </Field>
      </SectionForm>

      {canChangeSlug && <SlugForm product={product} />}
    </div>
  );
}

/**
 * The address, edited separately.
 *
 * Its own form because it is its own kind of change: saving it retires the
 * current slug into `slugHistory` so old links keep working, and doing that as
 * a side effect of "I fixed a typo in the name" would be surprising. Sharing
 * one submit button with the basics form would also mean every name edit
 * rewrote the URL.
 */
function SlugForm({ product }: { product: AdminProductView }) {
  const [state, formAction] = useActionState(changeSlugAction, null);
  const [dirty, setDirty] = useState(false);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="border-border flex flex-col gap-3 border-t pt-6">
      <input type="hidden" name="productId" value={product.id} />

      <FieldGroup
        title="Web address"
        description="Changing this keeps the old address working — it redirects."
      >
        {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[280px] flex-1 flex-col gap-1.5">
            <span className="text-subtle font-mono text-[12px]">/marketplace/</span>
            <Input
              name="slug"
              defaultValue={product.slug}
              onChange={(event) => setDirty(event.target.value !== product.slug)}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={80}
              className="font-mono"
            />
          </label>

          <SlugButton disabled={!dirty} />
        </div>

        {state?.ok && (
          <p role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300">
            Address updated. The previous one now redirects here.
          </p>
        )}
      </FieldGroup>
    </form>
  );
}

function SlugButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending || disabled}>
      {pending ? "Changing…" : "Change address"}
    </Button>
  );
}
