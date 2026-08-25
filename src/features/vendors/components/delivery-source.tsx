"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import {
  Field,
  FormErrors,
  useManualSubmit,
} from "@/features/products/components/section-form";
import { retryArtefactFetchAction, saveArtefactSourceAction } from "../version-actions";

export interface ArtefactSourceView {
  status: string;
  url?: string;
  checksumSha256?: string;
  repositoryUrl?: string;
  tag?: string;
  hasToken: boolean;
  lastAttemptAt?: string;
  failureReason?: string;
}

/**
 * Where a version's bytes come from, for the two methods that are not a direct upload —
 * vendor ticket 06.
 *
 * ## The sentence at the top is the most important thing on this component
 *
 * "Vendor-hosted" sounds like the customer downloads from the vendor. It does not: we
 * fetch once, verify the checksum, and serve our own copy forever. Vendors need to know
 * that, because otherwise they reasonably assume taking their server down takes their
 * product down — and because it is the thing that makes vendor ticket 12's promise
 * possible, that a customer who bought never loses what they bought.
 *
 * ## The token is write-only
 *
 * Sealed with AES-256-GCM bound to the version id and never rendered back. So an empty
 * token field on a re-save means "leave it alone", not "clear it" — a vendor editing a
 * tag must not silently drop a credential they cannot see. The placeholder says so.
 */
export function DeliverySource({
  productId,
  versionId,
  method,
  source,
  editable,
}: {
  productId: string;
  versionId: string;
  method: "vendor_hosted" | "repository";
  source?: ArtefactSourceView;
  /** A released version's artefact is frozen — §45. */
  editable: boolean;
}) {
  /*
   * Manual dispatch, for the same reason `section-form.tsx` documents at length:
   * React 19 requests a DOM `form.reset()` *before* running a function action.
   * There is no Radix control here, so this is the milder version of that bug —
   * but every field in this form is `defaultValue`-backed, and on a failed save
   * the typed URL, the 64-character SHA-256 and a freshly typed token all revert
   * to what was stored before the error renders. The token cannot be re-derived
   * from anything, so losing it costs a trip to the vendor's own settings.
   */
  const { state, pending, onSubmit } = useManualSubmit(saveArtefactSourceAction);
  const [retryState, retryAction] = useActionState(retryArtefactFetchAction, null);
  const failed = state && !state.ok ? state : null;
  const retryFailed = retryState && !retryState.ok ? retryState : null;

  const isHosted = method === "vendor_hosted";

  return (
    <div className="border-border flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13.5px] font-medium">
          {isHosted ? "Where your package lives" : "Which repository and tag"}
        </h4>
        {source && <StatusBadge status={source.status} />}
      </div>

      <p className="text-muted-foreground text-[12.5px] leading-relaxed">
        {isHosted
          ? "We fetch this once, check it against your checksum, and serve our own copy to " +
            "customers from then on. Your server going down does not take your product down."
          : "We pull that tag's tarball once and serve our own copy. We do not add customers " +
            "to your repository."}
      </p>

      {source?.status === "failed" && source.failureReason && (
        <div className="border-border bg-surface-muted/60 rounded-lg border px-3 py-2.5">
          <p className="text-[12.5px]">{source.failureReason}</p>
          {source.lastAttemptAt && (
            <p className="text-subtle mt-1 font-mono text-[11px]">
              Last tried {formatDateTime(source.lastAttemptAt)}
            </p>
          )}
          <form action={retryAction} className="mt-2.5">
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="versionId" value={versionId} />
            <Retry />
            {retryFailed && (
              <p className="mt-1 text-[12px] text-[var(--danger)]">{retryFailed.error}</p>
            )}
          </form>
        </div>
      )}

      {source?.status === "fetching" && (
        <p className="text-subtle text-[12.5px]">
          Fetching now. This can take a while for a large package — the page will show it once
          it lands.
        </p>
      )}

      {editable ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="versionId" value={versionId} />
          <input type="hidden" name="method" value={method} />

          {isHosted ? (
            <>
              <Field label="Package URL" htmlFor={`url-${versionId}`} required>
                <Input
                  id={`url-${versionId}`}
                  name="url"
                  type="url"
                  required
                  placeholder="https://"
                  defaultValue={source?.url ?? ""}
                />
              </Field>
              <Field
                label="SHA-256"
                htmlFor={`sum-${versionId}`}
                hint="64 hex characters. `shasum -a 256 your-package.zip` prints it."
                required
              >
                <Input
                  id={`sum-${versionId}`}
                  name="checksumSha256"
                  required
                  pattern="[A-Fa-f0-9]{64}"
                  // The visible hint above says this too, but a `pattern` with no `title` makes
                  // the browser's own bubble say "Please match the requested format." and nothing
                  // more — which is what a vendor reported on the licence-key field.
                  title="64 hexadecimal characters, as printed by shasum -a 256."
                  className="font-mono text-[12px]"
                  defaultValue={source?.checksumSha256 ?? ""}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Repository URL" htmlFor={`repo-${versionId}`} required>
                <Input
                  id={`repo-${versionId}`}
                  name="repositoryUrl"
                  type="url"
                  required
                  placeholder="https://github.com/you/your-product"
                  defaultValue={source?.repositoryUrl ?? ""}
                />
              </Field>
              <Field
                label="Tag"
                htmlFor={`tag-${versionId}`}
                hint="A tag or release name — not a branch. A branch moves; a release does not."
                required
              >
                <Input
                  id={`tag-${versionId}`}
                  name="tag"
                  required
                  defaultValue={source?.tag ?? ""}
                />
              </Field>
              <Field
                label="Access token"
                htmlFor={`token-${versionId}`}
                hint="Only for a private repository. Stored encrypted and never shown again."
              >
                <Input
                  id={`token-${versionId}`}
                  name="token"
                  type="password"
                  autoComplete="off"
                  placeholder={source?.hasToken ? "Saved — leave blank to keep it" : ""}
                />
              </Field>
            </>
          )}

          <ShowToken />

          <Save label={source ? "Save and fetch again" : "Save and fetch"} pending={pending} />
        </form>
      ) : (
        <p className="text-subtle text-[12.5px]">
          This version is released. Its artefact is what customers downloaded and cannot change
          — a correction ships as a new version.
        </p>
      )}
    </div>
  );
}

/**
 * A note rather than a control.
 *
 * There is deliberately no "show token" affordance: the ciphertext is bound to the
 * version id and the service has no read path that returns plaintext to a browser. Saying
 * so beats a vendor hunting for a reveal button that does not exist.
 */
function ShowToken() {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-subtle text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="underline decoration-dotted underline-offset-2"
      >
        What happens to my token?
      </button>
      {open && (
        <p className="mt-1.5 leading-relaxed">
          It is encrypted at rest with a key tied to this version, used only to fetch the
          tarball, and never displayed again — not to you and not to us. Replace it by typing a
          new one; leave the field blank to keep the one you saved.
        </p>
      )}
    </div>
  );
}

/** `pending` as a prop: `useFormStatus` reports nothing for a manual dispatch. */
function Save({ label, pending }: { label: string; pending: boolean }) {
  return (
    <Button type="submit" size="sm" className="w-fit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Retry() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Queuing…" : "Try again"}
    </Button>
  );
}
