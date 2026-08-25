"use client";

import { useActionState, useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime } from "@/lib/dates";
import type { VendorDocumentKind, VendorVerificationLevel } from "@/lib/db/enums";
import {
  confirmDocumentUploadAction,
  removeDocumentAction,
  requestDocumentUploadAction,
} from "../actions";

export interface DocumentView {
  id: string;
  level: VendorVerificationLevel;
  kind: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: string;
  /**
   * Whether the vendor may still take it back — see `isRemovable`.
   *
   * Decided on the server, not here: it depends on the level's status and the
   * date of the last decision, and a client that computed it would be one more
   * place for that rule to be wrong.
   */
  removable: boolean;
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
 * ## CORS: measured, and the numbers are worth keeping
 *
 * Ticket 05 recorded that bucket CORS was unset, which would kill the preflight for the `PUT`
 * below — and that is why product media took a URL instead of an upload. It is **no longer true**,
 * and the measurement was repeated in full on 2026-08-17 after an upload failed with
 * `Failed to fetch`:
 *
 * - `OPTIONS` on a freshly signed `vendor-document` URL, from both `http://127.0.0.1:3000` and
 *   `http://localhost:3000` → `200`, `access-control-allow-origin: *`,
 *   `access-control-allow-methods: GET, PUT, POST, DELETE, HEAD`,
 *   `access-control-allow-headers: content-type`.
 * - A real `PUT` with `Origin` and `Content-Type` set, browser header set and all → `200`, with
 *   `access-control-allow-origin` on the response.
 * - The whole round trip server-side — mint, `PUT`, `confirmUpload` including the magic-byte
 *   sniff → all green against the live bucket.
 *
 * So a `Failed to fetch` here is **not** the bucket and not the signature: it is the request never
 * leaving the browser. An extension, a VPN or a proxy blocking the storage host produces exactly
 * that, with no response for us to inspect — which is why the `catch` below names those causes
 * instead of repeating the browser's message. `npm run storage:probe` covers the server half so the
 * answer can be re-established rather than argued about.
 *
 * ## What still does not work
 *
 * `s3:DeleteObject` remains denied, so **erasure cannot be guaranteed by this
 * environment**: `purgeDecidedDocuments` attempts the delete, tolerates the
 * refusal, and stamps `purgedAt` to record that the object *should* be gone. It
 * does not claim that it is.
 *
 * That used to matter on every decision, because ticket 02 had documents erased
 * the moment a level was decided. It no longer runs then — AML/KYC requires the
 * evidence behind a payout to be retained, and `decideVerificationAction` sets
 * out why — so the denied permission now only blocks an erasure *request*, which
 * is rare, visible, and worth fixing the IAM policy for rather than working
 * around.
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
  const [removeState, removeDispatch, removePending] = useActionState(
    removeDocumentAction,
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<VendorDocumentKind>(kinds[0] ?? "other");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);

    const contentType = file.type || "application/octet-stream";

    /*
     * The whole round trip is inside the `try` — the mint included.
     *
     * It was outside, and a failure there was unrecoverable in the worst way: the rejection was
     * unhandled (the caller does `void upload(file)`), so `busy` stayed true, the spinner spun for
     * ever and no message appeared. Four of the five upload components in this codebase shared
     * that shape — this is the one that had somebody stuck in it, and the other three
     * (`requests/attachments`, `products/media-upload`, `payments/evidence-upload`) were fixed
     * with it.
     */
    try {
      const ticket = await requestDocumentUploadAction({
        level,
        kind,
        filename: file.name,
        contentType,
        sizeBytes: file.size,
      });

      if (!ticket.ok) throw new Error(ticket.error);

      /*
       * A cross-origin `PUT` straight to storage, and **the one place a browser can fail in a way
       * the server never sees**.
       *
       * `fetch` rejects with `TypeError: Failed to fetch` when the request never completed at all
       * — a blocked request, no network, a refused preflight. Surfacing that message verbatim is
       * what a vendor was shown, and it tells them nothing they can act on: they cannot tell it
       * apart from a bug in us, and "try again" does not fix any of its causes.
       *
       * So the two cases are separated. A *response* with a bad status is ours to explain (an
       * expired ticket, a size mismatch). No response at all is theirs to look at, and the message
       * says where.
       */
      const response = await fetch(ticket.data.url, {
        method: "PUT",
        headers: ticket.data.headers,
        body: file,
      }).catch(() => {
        throw new Error(
          "The file never reached our storage. Something between this browser and it blocked " +
            "the request — usually an extension, a VPN or a corporate proxy. Try a private " +
            "window with extensions off, or a different network.",
        );
      });

      if (!response.ok) {
        // 403 on a presigned PUT is nearly always the five-minute ticket expiring, which is worth
        // saying rather than leaving as a number.
        throw new Error(
          response.status === 403
            ? "That upload link had expired. Choose the file again — the link is only valid for a few minutes."
            : `Our storage refused the file (${response.status}). Nothing was saved.`,
        );
      }

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
          // Just uploaded, so nobody has read it: removable by definition. The
          // server says the same on the next render.
          removable: true,
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
      {removeState && !removeState.ok && (
        <p className="text-destructive text-[12.5px]">{removeState.error}</p>
      )}

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
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-subtle font-mono text-[11px]">
                  {KIND_LABELS[item.kind as VendorDocumentKind] ?? item.kind} ·{" "}
                  {formatBytes(item.sizeBytes)} · {item.uploadedAt}
                </span>

                {item.removable ? (
                  <form
                    action={removeDispatch}
                    onSubmit={() =>
                      setItems((current) => current.filter((row) => row.id !== item.id))
                    }
                  >
                    <input type="hidden" name="documentId" value={item.id} />
                    {/*
                      Removed from the list optimistically, because the row is
                      the only feedback there is and a server round trip leaves
                      the file sitting there looking un-clicked. `refreshSelling`
                      re-renders the real list a moment later, so a failure
                      corrects itself rather than lying permanently — and the
                      error below says so.
                    */}
                    <button
                      type="submit"
                      disabled={removePending}
                      aria-label={`Remove ${item.filename}`}
                      className="text-subtle hover:text-destructive rounded p-1 transition disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </form>
                ) : (
                  /*
                    Not a disabled button. A document a reviewer has already read
                    stays on file, and saying *that* is more useful than greying
                    out a control and leaving the reason to be guessed at.
                  */
                  <span className="text-subtle text-[11px] whitespace-nowrap">Reviewed</span>
                )}
              </div>
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
