"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip } from "lucide-react";
import { formatBytes } from "@/lib/format-bytes";
import { attachToRequestAction, createAttachmentUploadAction } from "../attachment-actions";
import { formatDateTime } from "@/lib/dates";

export interface AttachmentView {
  index: number;
  filename: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedAt: string;
}

/**
 * Files on a request — §19.
 *
 * ## Every file links to a route, never to the object
 *
 * The bucket serves any known key unsigned, and these are customer documents —
 * a spec, a price list, a spreadsheet of staff names.
 * `/api/request-files/[requestId]/[index]` checks who is asking and redirects
 * to a five-minute presigned GET. The storage key never reaches the browser at
 * all, which is exactly why the handle is the array position.
 *
 * ## The customer uploads; both sides read
 *
 * It is their document. Staff attaching files on a customer's behalf would blur
 * whose evidence is whose, and §34's whole shape is about keeping that clear —
 * so the staff workspace renders this read-only.
 */
export function Attachments({
  requestId,
  reference,
  attachments,
  canUpload,
}: {
  requestId: string;
  reference: string;
  attachments: AttachmentView[];
  canUpload: boolean;
}) {
  const [items, setItems] = useState(attachments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);

    const ticket = await createAttachmentUploadAction({
      requestId,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });

    if (!ticket.ok) {
      setBusy(false);
      setError(ticket.error);
      return;
    }

    try {
      // Straight to S3 — bytes never pass through the app server (AGENTS.md).
      const response = await fetch(ticket.data.uploadUrl, {
        method: "PUT",
        headers: ticket.data.headers,
        body: file,
      });
      if (!response.ok) throw new Error(`Upload refused (${response.status}).`);

      // Recorded only after the bytes landed. Attaching first would leave a row
      // pointing at an object that does not exist — the state ticket 14's
      // orphaned `probe.zip` was in.
      const attached = await attachToRequestAction({
        requestId,
        reference,
        storageKey: ticket.data.key,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!attached.ok) throw new Error(attached.error);

      setItems((current) => [
        ...current,
        {
          index: current.length,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          uploadedAt: formatDateTime(new Date()),
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't upload.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (items.length === 0 && !canUpload) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[16px] tracking-[-0.02em]">Files</h2>

      {items.length > 0 && (
        <ul className="border-border divide-border divide-y rounded-xl border">
          {items.map((item) => (
            <li
              key={item.index}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <a
                href={`/api/request-files/${requestId}/${item.index}`}
                className="flex min-w-0 items-center gap-2 text-[13px] underline underline-offset-4"
              >
                <FileText className="text-subtle size-4 shrink-0" aria-hidden />
                <span className="truncate">{item.filename}</span>
              </a>
              <span className="text-subtle shrink-0 font-mono text-[11px]">
                {item.sizeBytes ? `${formatBytes(item.sizeBytes)} · ` : ""}
                {item.uploadedAt}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div className="flex flex-col gap-1.5">
          <input
            ref={fileRef}
            id={`attach-${requestId}`}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,text/csv,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <label
            htmlFor={`attach-${requestId}`}
            className="border-border hover:bg-surface-muted flex w-fit cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px]"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Paperclip className="size-3.5" aria-hidden />
            )}
            Send us a file
          </label>
          {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
        </div>
      )}
    </section>
  );
}
