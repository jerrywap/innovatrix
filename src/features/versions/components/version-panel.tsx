"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ChevronDown, Download, FileText, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatBytes } from "@/lib/format-bytes";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormErrors, useManualSubmit } from "@/features/products/components/section-form";
import { FileUploader } from "./file-uploader";
import type { VersionActionSet } from "../action-set";
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
  actions,
  deliverySlot,
}: {
  version: VersionView;
  productId: string;
  isCurrent: boolean;
  defaultOpen: boolean;
  /** Vendor ticket 06 — whose actions to call. */
  actions: VersionActionSet;
  /**
   * Vendor ticket 06. When set, this version's bytes are mirrored or pulled rather than
   * uploaded, and `deliverySlot` renders the source form in place of the uploader.
   *
   * A slot rather than the component itself, so this file — shared with the staff
   * surface — does not import the vendor-only form and drag it into the admin bundle.
   */
  deliverySlot?: React.ReactNode;
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

        {/*
          Release is **not** here any more.
          
          It used to sit in this header row, three controls along from the uploader
          that would let it succeed — so a vendor clicked it, `releaseVersion`
          refused for want of an application package, and the thing to do about
          that was somewhere below the fold. It is now the last thing in the
          panel body, after the files, with its own gate stated before the click.
          
          What stays here is what is genuinely incidental: deprecating a release,
          and deleting a draft.
        */}
        <div className="flex gap-2">
          {version.status === "released" && (
            <TransitionButton
              action={actions.deprecateVersion}
              productId={productId}
              versionId={version.id}
              label="Deprecate"
              variant="outline"
            />
          )}
          {isDraft && (
            <TransitionButton
              action={actions.deleteVersion}
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

          <FileTable
            files={version.files}
            productId={productId}
            canRemove={isDraft}
            actions={actions}
          />

          {deliverySlot ? (
            deliverySlot
          ) : isDraft ? (
            <FileUploader productId={productId} versionId={version.id} actions={actions} />
          ) : (
            <p className="text-subtle text-[12.5px]">
              {version.version} is {version.status}. Its files are what customers already
              downloaded and cannot change — a correction ships as a new version.
            </p>
          )}

          {isDraft && (
            <>
              <NotesEditor version={version} productId={productId} actions={actions} />
              <ReleaseBlock
                version={version}
                productId={productId}
                actions={actions}
                needsSource={Boolean(deliverySlot)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Release, with its gate stated before the click.
 *
 * `releaseVersion` refuses for two reasons and they are knowable from here:
 * no `application_package` file, or — for a mirrored/pulled method — no artefact
 * that has actually been stored. So the button says which one is missing rather
 * than failing on press and leaving the vendor to guess. `ReadinessGaps` is the
 * precedent: name the blocker, and link to the thing that clears it.
 *
 * The server still refuses independently. This is not the check — it is the
 * reason, given in advance.
 */
function ReleaseBlock({
  version,
  productId,
  actions,
  needsSource,
}: {
  version: VersionView;
  productId: string;
  actions: VersionActionSet;
  /** True when the delivery method is mirrored or pulled rather than uploaded. */
  needsSource: boolean;
}) {
  const hasPackage = version.files.some((file) => file.kind === "application_package");
  const sourceStored = version.artefactSource?.status === "stored";

  const blocker = !hasPackage
    ? needsSource && !sourceStored
      ? "We have not fetched your artefact yet. Save the source above, and release once it says stored."
      : "Upload the application package above — that is the file a customer downloads."
    : null;

  return (
    <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
      <ReleaseButton
        action={actions.releaseVersion}
        productId={productId}
        versionId={version.id}
        disabled={Boolean(blocker)}
      />
      <p className="text-muted-foreground max-w-[58ch] text-[12.5px] leading-relaxed">
        {blocker ??
          `Releasing ${version.version} makes it downloadable and freezes its files. A correction after that ships as a new version.`}
      </p>
    </div>
  );
}

function ReleaseButton({
  action,
  productId,
  versionId,
  disabled,
}: {
  action: (
    previous: ActionResult<unknown> | null,
    formData: FormData,
  ) => Promise<ActionResult<unknown>>;
  productId: string;
  versionId: string;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const failed = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="versionId" value={versionId} />
      <Button type="submit" size="sm" disabled={disabled || pending}>
        {pending ? "Releasing…" : "Release this version"}
      </Button>
      {failed && <span className="text-destructive text-[12.5px]">{failed}</span>}
    </form>
  );
}

/**
 * Edit the notes on a draft.
 *
 * `updateVersion` has been in the action set since vendor ticket 06 and was
 * implemented on both surfaces — and **no component called it**, so §45's "edit
 * the release notes, never the artefacts" was unreachable from the UI. The
 * changelog, the requirements and the eligibility rule could only ever be set at
 * creation, which is exactly when a vendor knows least about them.
 *
 * Draft only, and deliberately narrower than the service allows: a released
 * version's notes are editable by the rule, but the panel for one is a record of
 * what customers already downloaded, and putting an edit form in it invites the
 * belief that the files can move too.
 */
function NotesEditor({
  version,
  productId,
  actions,
}: {
  version: VersionView;
  productId: string;
  actions: VersionActionSet;
}) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useManualSubmit(actions.updateVersion);
  const failed = state && !state.ok ? state : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-[12.5px] underline underline-offset-4"
      >
        <Pencil className="size-3" aria-hidden />
        Edit the notes for this version
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="border-border bg-surface-muted/40 flex flex-col gap-3 rounded-xl border p-3.5"
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="versionId" value={version.id} />

      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium">Changelog</span>
        <Input
          name="changelog"
          defaultValue={version.changelog ?? ""}
          maxLength={300}
          placeholder="Adds bulk invoicing and fixes the CSV export."
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium">Minimum requirements</span>
        <Textarea
          name="minimumRequirements"
          defaultValue={version.minimumRequirements ?? ""}
          rows={2}
          maxLength={2000}
        />
      </label>

      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save the notes"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function FileTable({
  files,
  productId,
  canRemove,
  actions,
}: {
  files: VersionView["files"];
  productId: string;
  canRemove: boolean;
  actions: VersionActionSet;
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
          <DownloadButton fileId={file.id} actions={actions} />
          {canRemove && (
            <RemoveFileButton productId={productId} fileId={file.id} actions={actions} />
          )}
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
function DownloadButton({ fileId, actions }: { fileId: string; actions: VersionActionSet }) {
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
          const result = await actions.downloadUrl(fileId);
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

function RemoveFileButton({
  productId,
  fileId,
  actions,
}: {
  productId: string;
  fileId: string;
  actions: VersionActionSet;
}) {
  const [state, formAction] = useActionState(actions.removeFile, null);

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
