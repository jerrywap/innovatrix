"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime } from "@/lib/dates";
import type { VendorDocumentKind, VendorVerificationLevel } from "@/lib/db/enums";
import { confirmDocumentUploadAction, requestDocumentUploadAction } from "../actions";

export interface DocumentView {
  id: string;
  level: VendorVerificationLevel;
  kind: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: string;
}

const KIND_LABELS: Record<VendorDocumentKind, string> = {
  government_id: "Government ID",
  proof_of_address: "Proof of address",
  company_registration: "Company registration",
  tax_document: "Tax document",
  bank_proof: "Proof of payout account",
  other: "Something else",
};

/**
 * Verification document upload — vendor ticket 02.
 *
 * ## Every document links to a route, never to the object
 *
 * The bucket serves any known key unsigned, so an unguessable URL is the only
 * thing standing between a passport scan and the internet — and that is not
 * protection. `/api/vendor-documents/[id]` checks the permission, writes an audit
 * row naming the reader, and then redirects to a five-minute presigned GET. The
 * storage key never reaches the browser, which is why the handle here is the
 * document id.
 *
 * ## Bytes go browser → S3 directly
 *
 * A presigned `PUT`, then a second action to record it. Never a file in a Server
 * Action body: there is a body limit a phone photo clears without trying, and
 * proxying puts the file through this process's memory for no benefit.
 *
 * ⚠️ **The browser half cannot work in this environment yet.** Bucket CORS is
 * unset and `GetBucketCors` is denied for the app's credential, so the preflight
 * for the `PUT` below fails — the same blocker that made product media take a URL
 * instead of an upload (ticket 05, ticket 06 note 3). A KYC document has no URL
 * alternative, so the path is built and proven server-side by
 * `npm run storage:probe`. The error the vendor sees is the fetch failure, which
 * is honest but unhelpful; it becomes correct the moment the bucket policy is set,
 * with no change here.
 */
export function DocumentUpload({
  level,
  documents,
  canUpload,
  kinds,
}: {
  level: VendorVerificationLevel;
  documents: DocumentView[];
  canUpload: boolean;
  kinds: readonly VendorDocumentKind[];
}) {
  const [items, setItems] = useState(documents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<VendorDocumentKind>(kinds[0] ?? "other");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);

    const contentType = file.type || "application/octet-stream";

    const ticket = await requestDocumentUploadAction({
      level,
      kind,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
    });

    if (!ticket.ok) {
      setBusy(false);
      setError(ticket.error);
      return;
    }

    try {
      const response = await fetch(ticket.data.url, {
        method: "PUT",
        headers: ticket.data.headers,
        body: file,
      });
      if (!response.ok) throw new Error(`Upload refused (${response.status}).`);

      // Recorded only after the bytes landed, so a record never points at an
      // object that does not exist.
      const confirmed = await confirmDocumentUploadAction({
        level,
        kind,
        storageKey: ticket.data.key,
        filename: file.name,
        contentType,
        sizeBytes: file.size,
      });
      if (!confirmed.ok) throw new Error(confirmed.error);

      setItems((current) => [
        {
          id: confirmed.data.documentId,
          level,
          kind,
          filename: file.name,
          sizeBytes: file.size,
          uploadedAt: formatDateTime(new Date()),
        },
        ...current,
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't upload.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 && (
        <ul className="border-border divide-border divide-y rounded-xl border">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <a
                href={`/api/vendor-documents/${item.id}`}
                className="flex min-w-0 items-center gap-2 text-[13px] underline underline-offset-4"
              >
                <FileText className="text-subtle size-4 shrink-0" aria-hidden />
                <span className="truncate">{item.filename}</span>
              </a>
              <span className="text-subtle shrink-0 font-mono text-[11px]">
                {KIND_LABELS[item.kind as VendorDocumentKind] ?? item.kind} ·{" "}
                {formatBytes(item.sizeBytes)} · {item.uploadedAt}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`kind-${level}`} className="sr-only">
            Document type
          </label>
          <select
            id={`kind-${level}`}
            value={kind}
            onChange={(event) => setKind(event.target.value as VendorDocumentKind)}
            className="border-border bg-background rounded-full border px-3 py-1.5 text-[12.5px]"
          >
            {kinds.map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option]}
              </option>
            ))}
          </select>

          <input
            ref={fileRef}
            id={`upload-${level}`}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          {/* An `aria-label` on a control with visible text must *contain* that
              text (WCAG 2.5.3), so the extra context is an sr-only span rather
              than a replacement name. */}
          <label
            htmlFor={`upload-${level}`}
            className="border-border hover:bg-surface-muted flex w-fit cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px]"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-3.5" aria-hidden />
            )}
            Upload<span className="sr-only"> a {level} verification document</span>
          </label>

          {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
        </div>
      )}
    </div>
  );
}
