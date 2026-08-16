"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-bytes";
import { PRODUCT_FILE_KINDS, type ProductFileKind } from "@/lib/db/enums";
import { confirmUploadAction, requestUploadAction } from "../actions";

/**
 * Direct-to-S3 upload with a progress bar.
 *
 * ## Why `XMLHttpRequest` in 2026
 *
 * `fetch` has no upload progress event. There is no workaround short of a
 * `ReadableStream` request body, which requires HTTP/2, is unsupported in
 * Safari, and needs `duplex: "half"`. This ticket's acceptance criterion is a
 * **500MB** upload; at a realistic upstream speed that is several minutes, and
 * a spinner with no number is indistinguishable from a hang. People cancel and
 * retry, which makes it worse.
 *
 * So: XHR, which has had `upload.onprogress` for twenty years.
 *
 * ## Why the checksum is conditional
 *
 * §44 wants SHA-256 shown to customers so they can verify what they downloaded.
 * Hashing in the browser needs `crypto.subtle.digest`, which takes an
 * `ArrayBuffer` — the **whole file in memory**. That is fine for a 40MB
 * documentation bundle and fatal for a 2GB package: the tab runs out of memory
 * and dies mid-upload, having already read the file once.
 *
 * §44 explicitly permits computing it on first download instead, so the split is
 * at 100MB. Below it, hash locally and put the digest in the signature so S3
 * itself rejects a corrupted upload. Above it, upload unhashed and leave
 * `checksumSha256` empty — which means "not yet computed", not "unverified
 * forever".
 *
 * ## What happens if the tab closes mid-upload
 *
 * Nothing is recorded. `confirmUpload` is a separate call, so an interrupted
 * upload leaves an object in the bucket with no document pointing at it —
 * invisible to everyone, and ticket 25's sweep collects it. The reverse order
 * would leave a file row whose download 404s.
 */

const HASH_LIMIT_BYTES = 100 * 1024 * 1024;

const KIND_LABELS: Record<ProductFileKind, string> = {
  application_package: "Application package",
  source_package: "Source code",
  documentation: "Documentation",
  database: "Database file",
  setup_guide: "Setup guide",
  sample_data: "Sample data",
  asset: "Related asset",
};

type Phase =
  | { state: "idle" }
  | { state: "hashing" }
  | { state: "uploading"; percent: number; sentBytes: number; totalBytes: number }
  | { state: "recording" }
  | { state: "error"; message: string };

export function FileUploader({
  productId,
  versionId,
  disabled,
  disabledReason,
}: {
  productId: string;
  versionId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [kind, setKind] = useState<ProductFileKind>("application_package");
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const busy = phase.state !== "idle" && phase.state !== "error";

  async function upload(file: File) {
    setPhase({ state: "idle" });

    try {
      let checksum: string | undefined;
      if (file.size <= HASH_LIMIT_BYTES) {
        setPhase({ state: "hashing" });
        checksum = await sha256Base64(file);
      }

      const ticket = await requestUploadAction({
        productId,
        versionId,
        kind,
        filename: file.name,
        // An unknown type from the OS is better declared as a byte stream than
        // guessed — the policy allowlist has `application/octet-stream` for it.
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        ...(checksum ? { checksumSha256: checksum } : {}),
      });

      if (!ticket.ok) {
        setPhase({ state: "error", message: ticket.error });
        return;
      }

      setPhase({ state: "uploading", percent: 0, sentBytes: 0, totalBytes: file.size });
      await putWithProgress(ticket.data.url, file, ticket.data.headers, (sent) => {
        setPhase({
          state: "uploading",
          percent: Math.round((sent / file.size) * 100),
          sentBytes: sent,
          totalBytes: file.size,
        });
      });

      setPhase({ state: "recording" });
      const recorded = await confirmUploadAction({
        productId,
        versionId,
        kind,
        storageKey: ticket.data.key,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        ...(checksum ? { checksumSha256: checksum } : {}),
      });

      if (!recorded.ok) {
        setPhase({ state: "error", message: recorded.error });
        return;
      }

      setPhase({ state: "idle" });
      if (inputRef.current) inputRef.current.value = "";
      // `confirmUploadAction` revalidated the wizard path; this is what makes
      // the new row appear without a manual reload.
      startTransition(() => {});
    } catch (error) {
      setPhase({
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : "The upload failed. Check the connection and try again.",
      });
    }
  }

  return (
    <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            File type
          </span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as ProductFileKind)}
            disabled={busy || disabled}
            className="border-border bg-background h-9 rounded-lg border px-2.5 text-[13px]"
          >
            {PRODUCT_FILE_KINDS.map((value) => (
              <option key={value} value={value}>
                {KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
          id={`upload-${versionId}`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || disabled}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-3.5" aria-hidden />
          )}
          Choose a file
        </Button>

        {phase.state === "uploading" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              xhrRef.current?.abort();
              setPhase({ state: "idle" });
            }}
          >
            <X className="size-3.5" aria-hidden />
            Cancel
          </Button>
        )}
      </div>

      {disabled && disabledReason && (
        <p className="text-muted-foreground text-[12.5px]">{disabledReason}</p>
      )}

      {phase.state === "hashing" && (
        <p role="status" className="text-muted-foreground text-[12.5px]">
          Checksumming before upload…
        </p>
      )}

      {phase.state === "uploading" && (
        <div className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-valuenow={phase.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
            className="bg-surface-muted h-1.5 overflow-hidden rounded-full"
          >
            <div
              className="h-full rounded-full bg-[var(--signal)] transition-[width] duration-200"
              style={{ width: `${phase.percent}%` }}
            />
          </div>
          <p className="text-subtle font-mono text-[11px]">
            {phase.percent}% · {formatBytes(phase.sentBytes)} of {formatBytes(phase.totalBytes)}
          </p>
        </div>
      )}

      {phase.state === "recording" && (
        <p role="status" className="text-muted-foreground text-[12.5px]">
          Verifying the upload…
        </p>
      )}

      {phase.state === "error" && (
        <p role="alert" className="text-[12.5px] text-[var(--danger)]">
          {phase.message}
        </p>
      )}

      <p className="text-subtle text-[11.5px]">
        Files over {formatBytes(HASH_LIMIT_BYTES)} are checksummed on first download instead of
        in the browser — hashing needs the whole file in memory.
      </p>
    </div>
  );

  function putWithProgress(
    url: string,
    file: File,
    headers: Record<string, string>,
    onProgress: (sent: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.open("PUT", url, true);
      // Verbatim — these are inside the SigV4 signature, so a changed or
      // missing header is a 403 from S3, not a warning.
      for (const [name, value] of Object.entries(headers)) {
        xhr.setRequestHeader(name, value);
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded);
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(uploadFailureMessage(xhr.status)));
      xhr.onerror = () =>
        reject(
          new Error(
            "The upload could not reach storage. This is usually the bucket's CORS " +
              "configuration — see the ticket 05 notes.",
          ),
        );
      xhr.onabort = () => reject(new Error("Upload cancelled."));

      xhr.send(file);
    });
  }
}

function uploadFailureMessage(status: number): string {
  if (status === 403) {
    return "Storage rejected the upload. The signed URL may have expired, or the file changed size after it was signed.";
  }
  if (status === 413) return "That file is larger than the signed size allows.";
  return `Storage refused the upload (HTTP ${status}).`;
}

/** base64(sha256(bytes)) — the format S3's `x-amz-checksum-sha256` expects. */
async function sha256Base64(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
