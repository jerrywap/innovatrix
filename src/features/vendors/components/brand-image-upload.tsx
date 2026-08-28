"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/file-dropzone";
import { useDirectUpload, type UploadPhase } from "@/features/uploads/use-direct-upload";
import { createBrandingUploadAction } from "../actions";

/**
 * A vendor's cover image or logo — pick it, see it, save it with the form.
 *
 * ## It previews at the shape the storefront will use
 *
 * A cover is cropped with `object-cover` into a wide band and a logo is fitted
 * with `object-contain` into a square, and those two do opposite things to the
 * same file. Previewing both as a generic thumbnail would show a vendor an image
 * that is not the one their storefront draws, and the first they would learn of
 * a badly cropped cover is on the live page. So the preview is the real
 * treatment at a smaller size.
 *
 * ## The URL is the field; the file input has no name
 *
 * The bytes have already gone to S3 by the time the form is submitted — the
 * hidden input is what `saveProfileAction` reads. A `name` on the file input
 * would post the file to a Server Action that has a body limit a phone photo
 * clears without trying, which is the whole reason for the presigned PUT.
 *
 * ## Removing sets `""`, not `null`
 *
 * An empty string is what a cleared text field submits, and `saveProfile` turns
 * it into an `$unset`. The object stays in the bucket — `s3:DeleteObject` is
 * denied — but nothing points at it, and the next upload overwrites it anyway
 * because the key is stable.
 */

const KINDS = {
  cover: {
    label: "Cover image",
    // No size in the copy: `FileDropzone` renders its own "Up to 5MB" from
    // `maxBytes`, and saying it twice reads as two different limits.
    hint: "Wide — around 1600 × 400. JPG, PNG or WebP.",
    noun: "cover image",
    frame: "aspect-[4/1] w-full",
    fit: "object-cover",
  },
  logo: {
    label: "Logo",
    hint: "Square works best. JPG, PNG or WebP.",
    noun: "logo",
    frame: "size-24",
    // Never cropped: it is a company logo, not a face, and `object-cover` eats
    // wordmarks. `vendor-byline.tsx` settled this.
    fit: "object-contain p-2",
  },
} as const;

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

export function BrandImageUpload({
  kind,
  name,
  defaultValue,
  alt,
}: {
  kind: keyof typeof KINDS;
  /** The hidden field's name — `coverUrl` or `logoUrl`. */
  name: string;
  defaultValue: string;
  alt: string;
}) {
  const config = KINDS[kind];
  const [url, setUrl] = useState(defaultValue);

  const { phase, upload } = useDirectUpload({
    maxBytes: MAX_BYTES,
    noun: config.noun,
    onUploaded: useCallback((result: { url: string }) => setUrl(result.url), []),
    mint: useCallback(
      (file: File) =>
        createBrandingUploadAction({
          kind,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      [kind],
    ),
  });

  const busy = phase.status === "signing" || phase.status === "uploading";

  return (
    <div className="flex flex-col gap-2.5">
      {/* Not a `File` input — see the docblock. The bytes are already stored. */}
      <input type="hidden" name={name} value={url} />

      {url ? (
        <div className="flex flex-wrap items-start gap-3">
          <div
            className={`border-border bg-surface-muted relative shrink-0 overflow-hidden rounded-xl border ${config.frame} ${kind === "cover" ? "max-w-[420px]" : ""}`}
          >
            <Image
              src={url}
              alt={alt}
              fill
              sizes="420px"
              className={config.fit}
              // `unoptimized` is deliberate and narrow: the URL carries a `?v=` stamp that
              // changes on every replacement, and the optimiser would otherwise cache a
              // resize of the previous bytes under a key that looks new. On a preview shown
              // to one person, the saving is not worth the staleness.
              unoptimized
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <FileDropzone
              onFilesSelected={(files) => files[0] && void upload(files[0])}
              accept={ACCEPT}
              maxBytes={MAX_BYTES}
              disabled={busy}
              label={busy ? uploadingLabel(phase) : "Replace"}
              className="w-fit"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() => setUrl("")}
              disabled={busy}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Remove {config.noun}
            </Button>
          </div>
        </div>
      ) : (
        <FileDropzone
          onFilesSelected={(files) => files[0] && void upload(files[0])}
          accept={ACCEPT}
          maxBytes={MAX_BYTES}
          disabled={busy}
          label={busy ? uploadingLabel(phase) : `Add a ${config.noun}`}
          hint={config.hint}
        />
      )}

      <output aria-live="polite" className={phase.status === "failed" ? "" : "sr-only"}>
        {phase.status === "failed" ? (
          <span className="text-[12px] text-red-600 dark:text-red-400">{phase.message}</span>
        ) : phase.status === "uploading" ? (
          `Uploading, ${phase.percent} percent`
        ) : (
          ""
        )}
      </output>
    </div>
  );
}

function uploadingLabel(phase: UploadPhase): string {
  return phase.status === "uploading" ? `Uploading ${phase.percent}%` : "Preparing…";
}
