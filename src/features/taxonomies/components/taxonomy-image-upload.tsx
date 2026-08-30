"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/file-dropzone";
import { useDirectUpload, type UploadPhase } from "@/features/uploads/use-direct-upload";
import { createTaxonomyImageUploadAction } from "../actions";

/**
 * The optional picture on a category's browse card.
 *
 * ## Why not `BrandImageUpload`
 *
 * That component is a vendor's: it imports `createBrandingUploadAction`, takes a
 * `cover | logo` kind and previews at the two shapes a storefront draws. The
 * genuinely reusable parts are `useDirectUpload` and `FileDropzone`, and they are
 * reused here. Adding a third `kind` and a second action to that component would
 * make one file answer to two features.
 *
 * ## It previews at 44px, which is the point
 *
 * The card tile is `size-11`. A large preview would let somebody approve an image
 * whose subject is illegible at the size it actually renders — the same reasoning
 * that makes the vendor cover preview a wide band rather than a thumbnail.
 *
 * ## The URL is the field; the file input has no name
 *
 * The bytes reach S3 before the form is submitted, and the hidden input is what
 * `updateTaxonomyAction` reads. A `name` on a file input would post the file to a
 * Server Action whose body limit a phone photo clears without trying, which is
 * the whole reason for the presigned `PUT`.
 *
 * Removing sets `""`, which the update turns into an `$unset` — the card then
 * falls back to the category's best-selling product, which is where it started.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

export function TaxonomyImageUpload({
  taxonomyId,
  defaultValue,
}: {
  taxonomyId: string;
  defaultValue: string;
}) {
  const [url, setUrl] = useState(defaultValue);

  const { phase, upload } = useDirectUpload({
    maxBytes: MAX_BYTES,
    noun: "image",
    onUploaded: useCallback((result: { url: string }) => setUrl(result.url), []),
    mint: useCallback(
      (file: File) =>
        createTaxonomyImageUploadAction({
          id: taxonomyId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      [taxonomyId],
    ),
  });

  const busy = phase.status === "signing" || phase.status === "uploading";

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium">
        Card image{" "}
        <span className="text-subtle font-normal">
          — optional; otherwise the best-selling product in it
        </span>
      </span>

      <input type="hidden" name="imageUrl" value={url} />

      <div className="flex flex-wrap items-center gap-2.5">
        {url && (
          <span className="border-border bg-surface-muted relative size-11 shrink-0 overflow-hidden rounded-xl border">
            <Image
              src={url}
              alt=""
              fill
              sizes="44px"
              className="object-cover"
              // Deliberate and narrow, as on the vendor preview: the URL carries a
              // `?v=` stamp that changes on replacement, and the optimiser would
              // otherwise serve a resize of the previous bytes under a key that
              // looks new.
              unoptimized
            />
          </span>
        )}

        <FileDropzone
          onFilesSelected={(files) => files[0] && void upload(files[0])}
          accept={ACCEPT}
          maxBytes={MAX_BYTES}
          disabled={busy}
          label={busy ? uploadingLabel(phase) : url ? "Replace" : "Add an image"}
          className="w-fit"
        />

        {url && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setUrl("")}
            disabled={busy}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Remove
          </Button>
        )}
      </div>

      {phase.status === "failed" && (
        <p className="text-danger text-[12.5px]">{phase.message}</p>
      )}
    </div>
  );
}

function uploadingLabel(phase: UploadPhase): string {
  if (phase.status === "signing") return "Preparing…";
  if (phase.status === "uploading") return `Uploading ${phase.percent}%`;
  return "Uploading…";
}
