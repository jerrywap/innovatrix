"use client";

import { useCallback, useState } from "react";
import type { ActionResult } from "@/lib/action-result";

/**
 * Browser → S3 in one hook — the shared half of every direct upload.
 *
 * ## Why this was extracted
 *
 * `MediaUpload` owned all of this, and owned it well: the `XMLHttpRequest`
 * below, the phase machine, and two bug fixes that are invisible until you hit
 * them. But it was welded to a product — `productId` is required and sent to the
 * action — and a vendor's logo has no product. The choice was to copy it or to
 * lift it, and a second copy is how one of them stops handling the hang
 * described below.
 *
 * So the hook owns the mechanism and knows nothing about what is being
 * uploaded; the caller supplies `mint`, which is the only part that differs.
 * Every caller keeps its own markup — a media row and a cover dropzone want
 * nothing in common visually.
 *
 * ## `XMLHttpRequest`, deliberately
 *
 * `fetch` has no upload-progress event. On a slow connection a 10MB image is
 * tens of seconds of a control that looks broken, and "did it work?" is the
 * question this whole thing exists to answer. `XMLHttpRequest.upload` is the
 * only browser API that reports it.
 *
 * ## The bytes never touch the Next.js server
 *
 * `mint` returns a presigned PUT and the browser uploads to S3 directly.
 * Routing the file through a Server Action would buffer it in the server's
 * memory to write it out again unchanged — and Server Actions have a body-size
 * limit a phone photo passes without effort.
 */

export type UploadPhase =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "uploading"; percent: number }
  | { status: "failed"; message: string };

/** What every mint action returns. Structurally the storage service's `UploadTicket` plus its URL. */
export interface UploadTicketData {
  uploadUrl: string;
  key: string;
  headers: Record<string, string>;
  publicUrl: string;
}

export interface UseDirectUploadOptions {
  /**
   * Ask the server for a presigned PUT.
   *
   * A callback rather than an action reference, because the guard differs by
   * surface: the staff media action begins `requirePermission("product.update")`
   * and refuses a vendor outright. Passing the action in is the fix vendor
   * ticket 04 applied to the wizard; this is the same fix one level down.
   */
  mint: (file: File) => Promise<ActionResult<UploadTicketData>>;
  /**
   * Refused in the browser before a round trip. Not a security boundary — the
   * scope policy is, server-side, before anything is signed — but a 200MB file
   * refused after a 200MB upload is a poor way to find out.
   */
  maxBytes: number;
  /** What to call the thing in a refusal: "image", "video", "cover image". */
  noun: string;
  onUploaded: (result: { url: string; storageKey: string }) => void;
}

export function useDirectUpload({ mint, maxBytes, noun, onUploaded }: UseDirectUploadOptions) {
  const [phase, setPhase] = useState<UploadPhase>({ status: "idle" });

  const upload = useCallback(
    async (file: File) => {
      if (file.size > maxBytes) {
        setPhase({
          status: "failed",
          message: `That ${noun} is ${mb(file.size)}. The limit is ${mb(maxBytes)}.`,
        });
        return;
      }

      setPhase({ status: "signing" });

      /*
       * The mint is inside a `try` — it was not, and that difference is a hang rather than an
       * error.
       *
       * `!ticket.ok` was handled; the action call **rejecting** was not. Callers do
       * `void upload(file)`, so a network failure reaching the server became an unhandled
       * rejection and the phase stayed `"signing"` for ever — a spinner with no message and no
       * way out. The same shape was fixed in the vendor document upload after somebody sat in it.
       */
      let ticket: ActionResult<UploadTicketData>;
      try {
        ticket = await mint(file);
      } catch {
        setPhase({
          status: "failed",
          message: "We could not start the upload. Check your connection and try again.",
        });
        return;
      }

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
          // `put()` already tells the two cases apart — S3's own `<Code>` for a refusal, and a
          // distinct message when the request never arrived — so this passes it through.
          message:
            error instanceof Error && error.message
              ? error.message
              : "The upload failed. Nothing was saved.",
        });
        return;
      }

      onUploaded({ url: ticket.data.publicUrl, storageKey: ticket.data.key });
      setPhase({ status: "idle" });
    },
    [mint, maxBytes, noun, onUploaded],
  );

  return { phase, upload };
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

    /*
     * The request never arrived — no status, no body, nothing to read.
     *
     * This said "usually a CORS rule that does not allow this origin", which was true when it was
     * written and is not any more: the bucket's CORS was measured on 2026-08-17 and allows `PUT`
     * with `content-type` from this origin (the numbers are in
     * `vendors/components/document-upload`). Leaving that guess in place sends somebody to
     * reconfigure a bucket that is already right, so the message names what actually produces
     * this once CORS is correct.
     */
    request.addEventListener("error", () =>
      reject(
        new Error(
          "The file never reached our storage. Something between this browser and it blocked " +
            "the request — usually an extension, a VPN or a corporate proxy.",
        ),
      ),
    );
    request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));

    request.send(file);
  });
}

export function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
