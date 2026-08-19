"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FileSignature, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptAgreementAction } from "../actions";

/**
 * Re-accept the vendor agreement — vendor ticket 07.
 *
 * Shown only when the accepted version is behind the one in force. Not a modal and not a
 * blocking interstitial: everything the vendor already sells keeps selling, their customers
 * keep their downloads, and the single thing they cannot do is submit something *new*. A
 * dialog that has to be dismissed before reaching any screen would be a harder gate than
 * the ticket asked for, and a worse one — it would interrupt somebody answering a support
 * message to make them read a contract.
 *
 * The version in force is not in this form. There is no field for it, which is a stronger
 * guarantee than validating one: a request cannot accept a version the server is not
 * currently offering.
 */
export function AgreementNotice({
  acceptedVersion,
  currentVersion,
}: {
  /** `null` when nothing was ever accepted — an application predating the record. */
  acceptedVersion: string | null;
  currentVersion: string;
}) {
  const [state, submit] = useActionState(acceptAgreementAction, null);

  if (state?.ok) {
    return (
      <p className="border-border bg-surface-muted/40 rounded-xl border px-4 py-3 text-[13px]">
        Accepted. You can submit products again.
      </p>
    );
  }

  return (
    <form
      action={submit}
      className="flex flex-col gap-3 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-4"
    >
      <h2 className="font-display flex items-center gap-2 text-[15.5px] tracking-[-0.02em]">
        <FileSignature className="text-subtle size-4" aria-hidden />
        Our vendor agreement has changed
      </h2>

      <p className="text-[13px]">
        You accepted version{" "}
        <span className="font-mono">{acceptedVersion ?? "an earlier version"}</span>; the
        current one is <span className="font-mono">{currentVersion}</span>. Everything you
        already sell is unaffected and your customers keep their software — but you cannot
        submit a new product for review until you accept it.
      </p>

      <p className="text-[13px]">
        {/* The vendor agreement, not `/terms` — which is the buyer's document and says nothing
            about selling. This link pointed there until the page existed. */}
        <a
          href="/terms/vendor"
          target="_blank"
          rel="noopener"
          className="underline underline-offset-4"
        >
          Read the agreement
        </a>
      </p>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Accept version
    </Button>
  );
}
