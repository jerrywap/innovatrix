"use client";

import { useCallback, useId } from "react";
import { Loader2, Upload } from "lucide-react";
import { useDirectUpload } from "@/features/uploads/use-direct-upload";
import { createMediaUploadAction } from "../actions";

/**
 * Pick a file, upload it straight to S3, put the resulting address in the URL
 * field beside it.
 *
 * ## The mechanism lives in `useDirectUpload`
 *
 * Presigned PUT, `XMLHttpRequest` progress, and the phase machine all moved to
 * `@/features/uploads/use-direct-upload` when the vendor storefront needed the
 * same three things for an image that has no product. What is left here is the
 * product-shaped part — which action to call and what the control looks like.
 * The reasoning for each of those decisions travelled with the code.
 *
 * ## It reports upward rather than reaching into the DOM
 *
 * The row owns the URL and the storage key, so an upload is just a second way
 * of filling in the address a human could have pasted — and the preview updates
 * because the row re-renders, not because anything was poked.
 *
 * ## `uploadAction` is a prop, for the same reason every other step's is
 *
 * It was a hard import of the staff action, which begins
 * `requirePermission("product.update")` — so on the vendor surface the media step refused with
 * "This area is for CoSetup staff" and no screenshot could be uploaded at all. Vendor ticket 04
 * parameterised the wizard by passing each surface's action in; this control sits one level below
 * the form that receives it and was missed.
 *
 * Defaulted to the staff action so every admin caller is unchanged.
 */
export interface MediaUploadProps {
  productId: string;
  /**
   * The object this row already points at, if any. Passing it makes the upload
   * an overwrite rather than a new object — so correcting a mistake replaces
   * the file instead of abandoning it, which matters while `s3:DeleteObject`
   * is denied and nothing ever cleans up after us.
   */
  replaceKey?: string;
  onUploaded: (result: { url: string; storageKey: string }) => void;
  /** The surface's own presigned-PUT action. Staff by default; the vendor wizard passes its own. */
  uploadAction?: typeof createMediaUploadAction;
  maxBytes?: number;
  /**
   * Upload into the `product-video` scope instead of `product-media`.
   *
   * The two differ in every way that matters to this control — accepted types, the
   * ceiling, and the wording of a refusal — so it is a flag rather than two
   * components: everything below the scope choice is identical, and a second copy
   * is how one of them stops handling the hang `useDirectUpload` describes.
   */
  video?: boolean;
}

export function MediaUpload({
  productId,
  replaceKey,
  onUploaded,
  uploadAction = createMediaUploadAction,
  video = false,
  maxBytes = video ? 200 * 1024 * 1024 : 10 * 1024 * 1024,
}: MediaUploadProps) {
  const inputId = useId();

  const { phase, upload } = useDirectUpload({
    maxBytes,
    noun: video ? "video" : "image",
    onUploaded,
    mint: useCallback(
      (file: File) =>
        uploadAction({
          productId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          ...(replaceKey ? { replaceKey } : {}),
          ...(video ? { video: true } : {}),
        }),
      [uploadAction, productId, replaceKey, video],
    ),
  });

  return (
    <div className="flex flex-col gap-1.5">
      <input
        id={inputId}
        type="file"
        accept={
          video
            ? "video/mp4,video/webm,video/quicktime"
            : "image/png,image/jpeg,image/webp,image/avif,image/gif"
        }
        className="sr-only"
        // No `name`: this must never be submitted with the form. The bytes have
        // already gone to S3 and the URL field is what the action reads.
        onChange={(event) => {
          const file = event.target.files?.[0];
          /*
           * Cleared here rather than after a successful upload, which is where it used to happen.
           * The stated intent was "choosing the same file twice fires `change` again — otherwise a
           * retry after a failure silently does nothing", and clearing only on success was the one
           * path where that did not hold: the input still held the failed file, so re-picking it
           * fired nothing. The `File` is already captured, so clearing first is safe.
           */
          event.target.value = "";
          if (file) void upload(file);
        }}
      />

      <label
        htmlFor={inputId}
        className="border-border hover:bg-surface-muted focus-within:ring-ring flex w-fit cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px]"
      >
        {phase.status === "signing" || phase.status === "uploading" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Upload className="size-3.5" aria-hidden />
        )}
        {phase.status === "uploading"
          ? `Uploading ${phase.percent}%`
          : phase.status === "signing"
            ? "Preparing…"
            : "Upload an image"}
      </label>

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
