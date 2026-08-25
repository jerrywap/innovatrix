"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { youTubeId } from "@/validators/common";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldGroup, SectionForm, type SectionFormProps } from "./section-form";
import { MediaUpload, type MediaUploadProps } from "./media-upload";
import { Repeater } from "./repeater";
import { saveMediaAction } from "../actions";
import type { AdminProductView, MediaView } from "@/services/catalog/product-view";

/**
 * Screenshots and video — §42 step 5.
 *
 * ## Uploads work now; they did not when ticket 05 shipped
 *
 * That ticket deferred this behind two environment blockers. Both were
 * re-checked rather than assumed, with `npm run storage:media-probe`:
 *
 * - **Bucket CORS** is configured. A real preflight from this origin against a
 *   signed URL returns `200` with `access-control-allow-origin`, and the PUT
 *   that follows returns `200`. So the upload control is here.
 * - **`s3:DeleteObject` is still denied** for this IAM user. That does not
 *   affect *replacing* an image — uploading over one reuses its key and S3
 *   overwrites in place, so a mistake gets corrected rather than abandoned.
 *   It does affect *deleting* a row: the object stays in the bucket. A
 *   storage-cost problem rather than a correctness one, said out loud below
 *   rather than discovered later from a bill.
 *
 * Pasting a URL still works and is still first-class — some media is hosted
 * elsewhere, and an upload is just a second way to fill the same field.
 *
 * Alt text is asked for on every image because §100's accessibility bar applies
 * to the marketplace, and an unlabelled screenshot is the most common way a
 * product page fails it.
 *
 * `action` is a prop so this form serves both wizard surfaces — vendor ticket 04.
 * Defaulted to the staff action, so every existing caller is unchanged and the
 * vendor pages pass their own. A second copy of the form per surface is how one of
 * them quietly stops having a field the other has.
 */
export function MediaForm({
  product,
  nextHref,
  action = saveMediaAction,
  uploadAction,
}: {
  product: AdminProductView;
  nextHref: string;
  action?: SectionFormProps["action"];
  /**
   * The surface's presigned-PUT action — vendor ticket 04.
   *
   * Two props rather than one, because they are two different capabilities: `action` saves the
   * section, `uploadAction` mints a signature for writing bytes into the bucket. The vendor
   * surface passes both; staff pass neither and get the defaults.
   */
  uploadAction?: MediaUploadProps["uploadAction"];
}) {
  return (
    <SectionForm action={action} productId={product.id} nextHref={nextHref}>
      <FieldGroup
        title="Screenshots"
        description="The first one is the marketplace card. At least one is needed before publishing."
      >
        <p className="border-border bg-surface-muted text-muted-foreground rounded-xl border px-3.5 py-2.5 text-[12.5px]">
          Upload an image or paste its address — the product page renders either. Uploading over
          an image replaces the stored file. Deleting a row removes it from the page but leaves
          the file in the bucket: this account cannot delete objects yet.
        </p>

        <Repeater
          initial={product.media}
          blank={blankMedia}
          addLabel="Add an image"
          emptyLabel="No screenshots yet."
          max={24}
          reorderable
          row={(media, index) => (
            <MediaRow
              media={media}
              index={index}
              productId={product.id}
              {...(uploadAction ? { uploadAction } : {})}
            />
          )}
        />
      </FieldGroup>
    </SectionForm>
  );
}

/**
 * The row owns its address, so an upload and a paste are the same edit.
 *
 * State rather than `defaultValue` only for the two fields an upload changes —
 * `Repeater` keys rows stably and moves the DOM node on reorder, so this
 * survives being moved.
 */
function MediaRow({
  media,
  index,
  productId,
  uploadAction,
}: {
  media: MediaView;
  index: number;
  productId: string;
  uploadAction?: MediaUploadProps["uploadAction"];
}) {
  const [url, setUrl] = useState(media.url ?? "");
  const [storageKey, setStorageKey] = useState(media.storageKey ?? "");

  /*
   * `kind` was a hidden passthrough and `blankMedia()` hard-coded `"screenshot"`,
   * so nothing in the UI could ever produce the `"video"` the enum, the model and
   * the public DTO had all supported since they were written.
   *
   * Three choices rather than two, because *how it arrives* is the thing a vendor
   * is actually deciding, and it changes which control appears. `video` covers the
   * last two; which one it is follows from whether `storageKey` or `url` is set,
   * exactly as the model's own comment anticipated.
   */
  const [source, setSource] = useState<MediaSource>(() =>
    media.kind === "video" ? (media.storageKey ? "video-file" : "youtube") : "screenshot",
  );
  const kind = source === "screenshot" ? "screenshot" : "video";

  return (
    <div className="flex flex-col gap-2.5">
      <input type="hidden" name={`media[${index}][kind]`} value={kind} />

      <div className="flex flex-wrap gap-1.5">
        {SOURCES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={source === option.value}
            onClick={() => {
              setSource(option.value);
              // Switching source abandons whatever the previous one pointed at.
              // Keeping it would leave a row whose control and whose value
              // disagree — a YouTube box showing an uploaded object's URL.
              setUrl("");
              setStorageKey("");
            }}
            className={`rounded-full border px-3 py-1 text-[12px] transition ${
              source === option.value
                ? "border-[var(--signal)] text-[var(--signal-text)]"
                : "border-border hover:bg-surface-muted text-muted-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <input type="hidden" name={`media[${index}][sortOrder]`} value={String(index)} />
      {/* Always rendered, so an upload into a brand-new row has somewhere to
          put the key — it used to be conditional on there already being one. */}
      <input type="hidden" name={`media[${index}][storageKey]`} value={storageKey} />

      <div className="flex gap-3">
        {url && source !== "video-file" && (
          // A plain <img>, not next/image: the URL is arbitrary and may not be
          // in `remotePatterns`, and a broken optimiser here would hide the
          // preview an admin is checking. Public pages use next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source === "youtube" ? thumbnailFor(url) : url}
            alt=""
            className="border-border bg-surface-muted size-16 shrink-0 rounded-lg border object-cover"
          />
        )}
        {url && source === "video-file" && (
          // The real file, muted and unautoplayed: a vendor checking they uploaded
          // the right video needs a frame, not a filename.
          <video
            src={url}
            muted
            preload="metadata"
            className="border-border bg-surface-muted size-16 shrink-0 rounded-lg border object-cover"
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Input
            name={`media[${index}][url]`}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              // Typed over by hand, so whatever object this used to point at is
              // no longer what renders. Keeping the key would attach the row to
              // a file it no longer shows.
              setStorageKey("");
            }}
            type={source === "youtube" ? "text" : "url"}
            placeholder={
              source === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://…"
            }
            aria-label={`${source === "screenshot" ? "Image" : "Video"} ${index + 1} address`}
            className="font-mono text-[12.5px]"
          />

          {source !== "youtube" && (
            <MediaUpload
              productId={productId}
              {...(uploadAction ? { uploadAction } : {})}
              // Present ⇒ overwrite that object. A wrong image corrected here
              // replaces the file rather than leaving it behind.
              {...(storageKey ? { replaceKey: storageKey } : {})}
              video={source === "video-file"}
              onUploaded={(result) => {
                setUrl(result.url);
                setStorageKey(result.storageKey);
              }}
            />
          )}

          <Input
            name={`media[${index}][alt]`}
            defaultValue={media.alt ?? ""}
            placeholder={
              source === "screenshot"
                ? "Describe the screenshot for someone who cannot see it"
                : "Describe what the video shows"
            }
            maxLength={200}
            aria-label={`${source === "screenshot" ? "Image" : "Video"} ${index + 1} description`}
            className="text-[13px]"
          />
        </div>
      </div>

      {/*
        Card image only for a screenshot. `CARD_PROJECTION` now filters to
        screenshots before slicing, so ticking this on a video would set a flag
        that the projection has already decided to ignore — a control that does
        nothing is worse than one that is absent.
      */}
      {source === "screenshot" && (
        <label className="flex items-center gap-2 text-[12.5px]">
          <Checkbox
            name={`media[${index}][isPrimary]`}
            value="on"
            defaultChecked={media.isPrimary}
          />
          Use as the marketplace card image
        </label>
      )}
    </div>
  );
}

function blankMedia(): MediaView {
  return { kind: "screenshot", sortOrder: 0, isPrimary: false };
}

/** How the media arrives, which is what the vendor is actually choosing. */
type MediaSource = "screenshot" | "video-file" | "youtube";

const SOURCES: ReadonlyArray<{ value: MediaSource; label: string }> = [
  { value: "screenshot", label: "Screenshot" },
  { value: "video-file", label: "Video file" },
  { value: "youtube", label: "YouTube link" },
];

/**
 * YouTube's own thumbnail for a watch URL, for the row preview.
 *
 * `hqdefault` rather than `maxresdefault`: the latter 404s for any video that was
 * never uploaded at 720p or above, and a missing preview reads as a rejected link.
 */
function thumbnailFor(raw: string): string {
  const id = youTubeId(raw);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}
