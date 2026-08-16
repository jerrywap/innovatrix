"use client";

import { useId, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { createMediaUploadAction } from "../actions";

type Phase =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "uploading"; percent: number }
  | { status: "failed"; message: string };

/**
 * Pick a file, upload it straight to S3, put the resulting address in the URL
 * field beside it.
 *
 * ## The bytes never touch the Next.js server
 *
 * The action returns a presigned PUT and the browser uploads to S3 directly.
 * Routing a 10MB screenshot through a Server Action would buffer it in the
 * server's memory to write it out again unchanged — and Server Actions have a
 * body-size limit that a phone photo passes without effort.
 *
 * ## `XMLHttpRequest`, deliberately
 *
 * `fetch` has no upload-progress event. On a slow connection a 10MB image is
 * tens of seconds of a button that looks broken, and "did it work?" is the
 * question this whole control exists to answer. `XMLHttpRequest.upload` is the
 * only browser API that reports it.
 *
 * ## It reports upward rather than reaching into the DOM
 *
 * The row owns the URL and the storage key, so an upload is just a second way
 * of filling in the address a human could have pasted — and the preview updates
 * because the row re-renders, not because anything was poked.
 */
export function MediaUpload({
  productId,
  replaceKey,
  onUploaded,
  maxBytes = 10 * 1024 * 1024,
}: {
  productId: string;
  /**
   * The object this row already points at, if any. Passing it makes the upload
   * an overwrite rather than a new object — so correcting a mistake replaces
   * the file instead of abandoning it, which matters while `s3:DeleteObject`
   * is denied and nothing ever cleans up after us.
   */
  replaceKey?: string;
  onUploaded: (result: { url: string; storageKey: string }) => void;
  maxBytes?: number;
}) {
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (file.size > maxBytes) {
      setPhase({
        status: "failed",
        message: `That image is ${mb(file.size)}. The limit is ${mb(maxBytes)}.`,
      });
      return;
    }

    setPhase({ status: "signing" });

    const ticket = await createMediaUploadAction({
      productId,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      ...(replaceKey ? { replaceKey } : {}),
    });

    if (!ticket.ok) {
      setPhase({ status: "failed", message: ticket.error });
      return;
    }

    setPhase({ status: "uploading", percent: 0 });

    try {
      await put(ticket.data.uploadUrl, ticket.data.headers, file, (percent) =>
        setPhase({ status: "uploading", percent }),
      );
    } catch (error) {
      setPhase({
        status: "failed",
        // The browser reports a CORS rejection as an opaque network error, so
        // this cannot say which it was. It can say what to check.
        message:
          error instanceof Error && error.message
            ? error.message
            : "The upload failed. If this persists, check the bucket's CORS rules.",
      });
      return;
    }

    onUploaded({ url: ticket.data.publicUrl, storageKey: ticket.data.key });
    setPhase({ status: "idle" });
    // Cleared so choosing the same file twice fires `change` again — otherwise
    // a retry after a failure silently does nothing.
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={fileRef}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
        className="sr-only"
        // No `name`: this must never be submitted with the form. The bytes have
        // already gone to S3 and the URL field is what the action reads.
        onChange={(event) => {
          const file = event.target.files?.[0];
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

/** PUT with progress. Resolves on 2xx, rejects with S3's reason otherwise. */
function put(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);

    // Verbatim, or the signature does not match what S3 recomputes.
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      // S3 explains itself in an XML body; surfacing the code beats "failed".
      const code = /<Code>([^<]+)<\/Code>/.exec(request.responseText)?.[1];
      reject(
        new Error(
          code ? `S3 refused the upload: ${code}.` : `Upload failed (${request.status}).`,
        ),
      );
    });

    request.addEventListener("error", () =>
      reject(
        new Error(
          "The upload could not reach the bucket — usually a CORS rule that does not " +
            "allow this origin.",
        ),
      ),
    );
    request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));

    request.send(file);
  });
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
