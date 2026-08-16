"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ChevronDown, Download, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatBytes } from "@/lib/format-bytes";
import { FormErrors } from "@/features/products/components/section-form";
import { FileUploader } from "./file-uploader";
import {
  deleteVersionAction,
  deprecateVersionAction,
  releaseVersionAction,
  removeFileAction,
  staffDownloadUrlAction,
} from "../actions";
import type { ActionResult } from "@/lib/action-result";
import type { VersionView } from "../view";

/**
 * One version, with its files.
 *
 * ## The controls a released version does *not* have
 *
 * Upload, delete-file and delete-version disappear once released, and their
 * absence is explained in place rather than left as a puzzle. §45's rule is
 * that a released version's artefacts are frozen — the server refuses either
 * way, but a button that always fails is worse than no button.
 *
 * Editing notes stays available, because that is the one thing the rule
 * explicitly permits.
 */
export function VersionPanel({
  version,
  productId,
  isCurrent,
  defaultOpen,
}: {
  version: VersionView;
  productId: string;
  isCurrent: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isDraft = version.status === "draft";

  return (
    <div className="border-border bg-surface overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronDown
            className={`size-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          />
          <span className="font-mono text-[14px] font-medium">{version.version}</span>
          <StatusBadge status={version.status} />
          {isCurrent && (
            <span className="rounded-full bg-[var(--signal)]/12 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-[var(--signal)] uppercase">
              Current
            </span>
          )}
          <span className="text-subtle truncate text-[12.5px]">
            {version.files.length} file{version.files.length === 1 ? "" : "s"}
            {version.releasedAt ? ` · released ${version.releasedAt}` : ""}
          </span>
        </button>

        <div className="flex gap-2">
          {isDraft && (
            <TransitionButton
              action={releaseVersionAction}
              productId={productId}
              versionId={version.id}
              label="Release"
              variant="default"
            />
          )}
          {version.status === "released" && (
            <TransitionButton
              action={deprecateVersionAction}
              productId={productId}
              versionId={version.id}
              label="Deprecate"
              variant="outline"
            />
          )}
          {isDraft && (
            <TransitionButton
              action={deleteVersionAction}
              productId={productId}
              versionId={version.id}
              label="Delete"
              variant="ghost"
            />
          )}
        </div>
      </div>

      {open && (
        <div className="border-border flex flex-col gap-4 border-t p-4">
          {version.changelog && (
            <p className="text-muted-foreground text-[13px]">{version.changelog}</p>
          )}

          {version.updateEligibility && (
            <p className="border-border text-subtle rounded-lg border border-dashed px-3 py-2 text-[12.5px]">
              <span className="font-medium">Free upgrade for: </span>
              {version.updateEligibility.includesPriorMajor
                ? "owners of any previous major version"
                : version.updateEligibility.freeFromVersion
                  ? `owners of ${version.updateEligibility.freeFromVersion} and newer`
                  : "owners within the same major version"}
              {version.updateEligibility.note ? ` — ${version.updateEligibility.note}` : ""}
            </p>
          )}

          <FileTable files={version.files} productId={productId} canRemove={isDraft} />

          {isDraft ? (
            <FileUploader productId={productId} versionId={version.id} />
          ) : (
            <p className="text-subtle text-[12.5px]">
              {version.version} is {version.status}. Its files are what customers already
              downloaded and cannot change — a correction ships as a new version.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FileTable({
  files,
  productId,
  canRemove,
}: {
  files: VersionView["files"];
  productId: string;
  canRemove: boolean;
}) {
  if (files.length === 0) {
    return (
      <p className="border-border text-subtle rounded-lg border border-dashed px-3 py-4 text-center text-[12.5px]">
        No files yet. A version needs an application package before it can be released.
      </p>
    );
  }

  return (
    <ul className="divide-border border-border divide-y overflow-hidden rounded-lg border">
      {files.map((file) => (
        <li key={file.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <FileText className="text-subtle size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{file.filename}</p>
            <p className="text-subtle font-mono text-[11px]">
              {file.kindLabel} · {formatBytes(file.sizeBytes)}
              {file.checksumSha256
                ? ` · sha256 ${file.checksumSha256.slice(0, 12)}…`
                : " · checksum on first download"}
            </p>
          </div>
          <DownloadButton fileId={file.id} />
          {canRemove && <RemoveFileButton productId={productId} fileId={file.id} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * Fetches a short-lived URL and follows it, rather than rendering one in the
 * page. A presigned URL in the HTML is a link anyone with the page source can
 * use for its whole lifetime — including a bot that scraped it.
 */
function DownloadButton({ fileId }: { fileId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await staffDownloadUrlAction(fileId);
          setPending(false);
          if (result.ok) window.location.href = result.data.url;
          else setError(result.error);
        }}
      >
        <Download className="size-3.5" aria-hidden />
        <span className="sr-only">Download </span>
        Get
      </Button>
      {error && (
        <span role="alert" className="text-[11.5px] text-[var(--danger)]">
          {error}
        </span>
      )}
    </>
  );
}

function RemoveFileButton({ productId, fileId }: { productId: string; fileId: string }) {
  const [state, formAction] = useActionState(removeFileAction, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="fileId" value={fileId} />
      <SubmitIcon />
      {state && !state.ok && (
        <span role="alert" className="text-[11.5px] text-[var(--danger)]">
          {state.error}
        </span>
      )}
    </form>
  );
}

function SubmitIcon() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending}>
      <Trash2 className="size-3.5" aria-hidden />
      <span className="sr-only">Remove this file</span>
    </Button>
  );
}

/**
 * Release / Deprecate / Delete, which differ only in which action they post to.
 *
 * The prop is typed as an action over `ActionResult<unknown>` rather than
 * inferred from `useActionState`: that helper's parameter widens to
 * `(state: unknown, payload: unknown) => unknown`, which accepts anything and
 * would let a form here post to an action with a different signature.
 */
type VersionAction = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<unknown>>;

function TransitionButton({
  action,
  productId,
  versionId,
  label,
  variant,
}: {
  action: VersionAction;
  productId: string;
  versionId: string;
  label: string;
  variant: "default" | "outline" | "ghost";
}) {
  const [state, formAction] = useActionState(action, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="versionId" value={versionId} />
      <Submit label={label} variant={variant} />
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}
    </form>
  );
}

function Submit({
  label,
  variant,
}: {
  label: string;
  variant: "default" | "outline" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {label}
    </Button>
  );
}
