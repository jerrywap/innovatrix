"use client";

import { useId, useRef, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { createEvidenceUploadAction } from "../actions";

/**
 * Attaching a receipt to a payment — shared by the order and invoice forms.
 *
 * ## The receipt uploads before the payment exists
 *
 * The staff member picks a file, then submits. So the client mints a `draftId`,
 * the key is built under `payments/{draftId}/`, and the same id becomes the
 * payment's `_id` — which is what lets the server check the key belongs to the
 * payment it just created. The two match only because they come from the one
 * value generated here and submitted with the form.
 *
 * ## Bytes never pass through our server
 *
 * A presigned PUT straight to S3 (AGENTS.md). The form carries a key; the file
 * input deliberately has no `name`, because submitting the file as well would
 * push the bytes through the action.
 */

export interface Evidence {
  key: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export function useEvidenceUpload() {
  // A 24-hex id, the shape `objectIdSchema` wants, generated once per mount.
  const [draftId] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );

  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);

    const ticket = await createEvidenceUploadAction({
      draftId,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });

    if (!ticket.ok) {
      setUploading(false);
      setError(ticket.error);
      return;
    }

    try {
      const response = await fetch(ticket.data.uploadUrl, {
        method: "PUT",
        headers: ticket.data.headers,
        body: file,
      });
      if (!response.ok) throw new Error(`S3 refused the upload (${response.status}).`);

      setEvidence({
        key: ticket.data.key,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return { draftId, evidence, uploading, error, upload, fileRef };
}

/** The hidden fields the action reads. Rendered only once something is attached. */
export function EvidenceFields({ evidence }: { evidence: Evidence | null }) {
  if (!evidence) return null;

  return (
    <>
      <input type="hidden" name="evidenceKey" value={evidence.key} />
      <input type="hidden" name="evidenceFilename" value={evidence.filename} />
      <input type="hidden" name="evidenceContentType" value={evidence.contentType} />
      <input type="hidden" name="evidenceSizeBytes" value={String(evidence.sizeBytes)} />
    </>
  );
}

export function EvidencePicker({
  evidence,
  uploading,
  error,
  onPick,
  fileRef,
}: {
  evidence: Evidence | null;
  uploading: boolean;
  error: string | null;
  onPick: (file: File) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  const fileId = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">
        Evidence <span className="text-subtle font-normal">— receipt or remittance advice</span>
      </span>

      <input
        ref={fileRef}
        id={fileId}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="sr-only"
        // No `name` — see the note at the top of this file.
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
        }}
      />

      <label
        htmlFor={fileId}
        className="border-border hover:bg-surface-muted flex w-fit cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px]"
      >
        {uploading ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Paperclip className="size-3.5" aria-hidden />
        )}
        {evidence ? "Replace the file" : "Attach a receipt"}
      </label>

      {evidence && (
        <p className="text-subtle text-[12px]">
          {evidence.filename} attached. Only staff with payment access can open it.
        </p>
      )}
      {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
    </div>
  );
}
