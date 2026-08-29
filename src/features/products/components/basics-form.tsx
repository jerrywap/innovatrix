"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { changeSlugAction, enhanceProseAction, saveBasicsAction } from "../actions";
import {
  Field,
  FieldGroup,
  FormErrors,
  SectionForm,
  type SectionFormProps,
} from "./section-form";
import { RichTextEditor, type RichTextHandle } from "./rich-text-editor";
import { EnhanceButton } from "./enhance-button";
import { CompareProseDialog } from "./compare-dialog";
import type { AdminProductView } from "@/services/catalog/product-view";
import { SLUG_INPUT_ATTRS } from "@/validators/common";

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
  enhance = enhanceProseAction,
  aiUnavailable,
}: {
  product: AdminProductView;
  nextHref: string;
  action?: SectionFormProps["action"];
  canChangeSlug?: boolean;
  /**
   * The surface's own rewrite action. Staff by default; the vendor wizard passes
   * its own, for the reason every other prop here is a prop — the staff action
   * begins `requirePermission("product.update")` and refuses a vendor outright.
   */
  enhance?: typeof enhanceProseAction;
  /** Set when AI is off, so the control explains itself rather than vanishing. */
  aiUnavailable?: string;
}) {
  /*
   * The name and the summary are read out of the DOM when the rewrite runs
   * rather than mirrored into state.
   *
   * They are uncontrolled inputs with a `defaultValue`, which is what the rest of
   * this wizard does and what survives the form's own re-renders. Lifting them
   * into state purely to hand two strings to a model would make every keystroke a
   * React render on a step that has none today.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const descriptionRef = useRef<RichTextHandle>(null);

  const fieldValue = (name: string) => {
    const element = formRef.current?.elements.namedItem(name);
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : "";
  };

  const [summary, setSummary] = useState(product.summary);
  const [compare, setCompare] = useState<null | {
    field: "summary" | "description";
    mine: string;
    suggested: string;
  }>(null);

  return (
    <div className="flex flex-col gap-8">
      <SectionForm formRef={formRef} action={action} productId={product.id} nextHref={nextHref}>
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
          action={
            <EnhanceButton
              label="Enhance summary"
              {...(aiUnavailable ? { disabledReason: aiUnavailable } : {})}
              run={() =>
                enhance({
                  field: "summary",
                  text: summary,
                  name: fieldValue("name"),
                  description: descriptionRef.current?.getHTML() ?? "",
                })
              }
              onResult={({ text }) =>
                setCompare({ field: "summary", mine: summary, suggested: text })
              }
            />
          }
        >
          {/*
            Controlled, unlike the name beside it. The rewrite has to be able to
            replace this value, and a `defaultValue` textarea cannot be written to
            from React without reaching into the DOM.
          */}
          <Textarea
            id="product-summary"
            name="summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
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
          action={
            <EnhanceButton
              label="Enhance description"
              {...(aiUnavailable ? { disabledReason: aiUnavailable } : {})}
              run={() =>
                enhance({
                  field: "description",
                  // HTML both ways — see `RichTextHandle`. `plainText` would
                  // collapse every heading and list into one paragraph.
                  text: descriptionRef.current?.getHTML() ?? "",
                  name: fieldValue("name"),
                  summary,
                })
              }
              onResult={({ text }) =>
                setCompare({
                  field: "description",
                  mine: descriptionRef.current?.getHTML() ?? "",
                  suggested: text,
                })
              }
            />
          }
        >
          <RichTextEditor
            name="description"
            defaultValue={product.description}
            handleRef={descriptionRef}
          />
        </Field>
      </SectionForm>

      {/*
        Outside `SectionForm`, and it makes no difference — `DialogContent`
        portals to `document.body`, so nothing in here is in the form's DOM
        subtree wherever it is written. That is precisely why accepting writes
        through `setSummary` / `setHTML` into the real controls above rather than
        rendering an input in the dialog.
      */}
      {compare && (
        <CompareProseDialog
          open
          onOpenChange={(next) => !next && setCompare(null)}
          title={compare.field === "summary" ? "Suggested summary" : "Suggested description"}
          mine={compare.mine}
          suggested={compare.suggested}
          // The description is HTML both ways; the summary is a plain sentence.
          rich={compare.field === "description"}
          onMineChange={(mine) => setCompare({ ...compare, mine })}
          onSuggestedChange={(suggested) => setCompare({ ...compare, suggested })}
          onAccept={(value) => {
            if (compare.field === "summary") setSummary(value);
            else descriptionRef.current?.setHTML(value);
            setCompare(null);
          }}
        />
      )}

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
              // Pattern, length bounds and the message the browser shows, from the one place
              // that mirrors `slugSchema`.
              {...SLUG_INPUT_ATTRS}
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
