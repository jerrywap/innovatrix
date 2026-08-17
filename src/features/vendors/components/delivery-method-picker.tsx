"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { FormErrors } from "@/features/products/components/section-form";
import type { DeliveryMethod } from "@/lib/db/enums";
import { setDeliveryMethodAction } from "../version-actions";

const OPTIONS: ReadonlyArray<{ value: DeliveryMethod; label: string; detail: string }> = [
  {
    value: "archive",
    label: "Upload a package",
    detail: "You upload the file here. Simplest, and what most vendors want.",
  },
  {
    value: "vendor_hosted",
    label: "We fetch it from your server",
    detail:
      "You give us a URL and a checksum. We fetch it once and serve our own copy — your " +
      "server going down does not take your product down.",
  },
  {
    value: "repository",
    label: "We pull a tag from your repository",
    detail:
      "GitHub or GitLab. We pull that tag's tarball once and serve our own copy. We do not " +
      "add customers to your repository.",
  },
];

/**
 * How this product's bytes reach us — vendor ticket 06.
 *
 * ## Why all three are offered together, and none is hidden
 *
 * The ticket's rule is that an unimplemented option in a dropdown is a support thread.
 * All three paths work, so all three are here — and the copy for each says what actually
 * happens, because two of the three names mislead. "We fetch it from your server" is
 * spelled out rather than called "self-hosted", which is what a vendor would read as
 * "customers download from me".
 *
 * Switching is allowed at any time and needs no migration: `deliveryMethod` is a seam,
 * every already-released version keeps its stored `ProductFile`, and the customer's
 * download path never changed in the first place.
 */
export function DeliveryMethodPicker({
  productId,
  method,
}: {
  productId: string;
  method: DeliveryMethod;
}) {
  const [state, formAction] = useActionState(setDeliveryMethodAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form
      action={formAction}
      className="border-border flex flex-col gap-3 rounded-xl border p-5"
    >
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <input type="hidden" name="productId" value={productId} />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-[13.5px] font-medium">How you supply your software</legend>

        {OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2.5">
            <input
              type="radio"
              name="method"
              value={option.value}
              defaultChecked={option.value === method}
              className="mt-1"
            />
            <span>
              <span className="text-[13px] font-medium">{option.label}</span>
              <span className="text-muted-foreground block text-[12.5px] leading-relaxed">
                {option.detail}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="border-border flex flex-wrap items-center gap-3 border-t pt-3">
        <Save />
        <p className="text-subtle text-[12.5px]">
          Changing this leaves every released version downloadable.
        </p>
      </div>
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}
