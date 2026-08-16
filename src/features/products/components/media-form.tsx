"use client";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldGroup, SectionForm } from "./section-form";
import { Repeater } from "./repeater";
import { saveMediaAction } from "../actions";
import type { AdminProductView, MediaView } from "@/services/catalog/product-view";

/**
 * Screenshots and video — §42 step 5.
 *
 * ## Uploads are not wired up yet, and the reason is not code
 *
 * Ticket 05 landed with two unresolved environment blockers that bite exactly
 * here: **bucket CORS is not configured**, so a browser upload fails its
 * preflight before a byte moves, and **`s3:DeleteObject` is denied**, so a
 * screenshot could be added and never removed. The signing path itself works —
 * the storage probe proved a server-side PUT round-trips.
 *
 * So this step takes a **URL** for now. That is honest: it stores real media,
 * renders on the product page, and satisfies the publish gate, without
 * pretending an upload button works when it cannot. `FileDropzone` and the
 * presigned PUT drop in behind the same schema — `media[].storageKey` already
 * exists alongside `url` — once the bucket is fixed.
 *
 * Alt text is asked for on every image because §100's accessibility bar applies
 * to the marketplace, and an unlabelled screenshot is the most common way a
 * product page fails it.
 */
export function MediaForm({
  product,
  nextHref,
}: {
  product: AdminProductView;
  nextHref: string;
}) {
  return (
    <SectionForm action={saveMediaAction} productId={product.id} nextHref={nextHref}>
      <FieldGroup
        title="Screenshots"
        description="The first one is the marketplace card. At least one is needed before publishing."
      >
        <p className="border-border bg-surface-muted text-muted-foreground rounded-xl border px-3.5 py-2.5 text-[12.5px]">
          Direct uploads are waiting on bucket CORS, which has to be set by someone with console
          access. Until then, paste an image URL — the product page renders it either way.
        </p>

        <Repeater
          initial={product.media}
          blank={blankMedia}
          addLabel="Add an image"
          emptyLabel="No screenshots yet."
          max={24}
          reorderable
          row={(media, index) => <MediaRow media={media} index={index} />}
        />
      </FieldGroup>
    </SectionForm>
  );
}

function MediaRow({ media, index }: { media: MediaView; index: number }) {
  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={`media[${index}][kind]`} value={media.kind} />
      <input type="hidden" name={`media[${index}][sortOrder]`} value={String(index)} />
      {media.storageKey && (
        <input type="hidden" name={`media[${index}][storageKey]`} value={media.storageKey} />
      )}

      <div className="flex gap-3">
        {(media.url ?? media.storageKey) && (
          // A plain <img>, not next/image: the URL is arbitrary and may not be
          // in `remotePatterns`, and a broken optimiser here would hide the
          // preview an admin is checking. Public pages use next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.url ?? ""}
            alt=""
            className="border-border bg-surface-muted size-16 shrink-0 rounded-lg border object-cover"
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Input
            name={`media[${index}][url]`}
            defaultValue={media.url ?? ""}
            type="url"
            placeholder="https://…"
            aria-label={`Image ${index + 1} address`}
            className="font-mono text-[12.5px]"
          />
          <Input
            name={`media[${index}][alt]`}
            defaultValue={media.alt ?? ""}
            placeholder="Describe the screenshot for someone who cannot see it"
            maxLength={200}
            aria-label={`Image ${index + 1} description`}
            className="text-[13px]"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[12.5px]">
        <Checkbox
          name={`media[${index}][isPrimary]`}
          value="on"
          defaultChecked={media.isPrimary}
        />
        Use as the marketplace card image
      </label>
    </div>
  );
}

function blankMedia(): MediaView {
  return { kind: "screenshot", sortOrder: 0, isPrimary: false };
}
