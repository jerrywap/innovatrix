"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Check, Download, Loader2 } from "lucide-react";
import { claimFreeProductAction } from "../actions";

/**
 * "Download for Free" — COS-12's one click.
 *
 * ## Why it is not just `AddToCart` with a different label
 *
 * The basket and checkout exist to collect an address and take money. A listing
 * with nothing to pay needs neither, and walking somebody through both to hand
 * them a £0 invoice is the ceremony this replaces. Everything *behind* the click
 * is unchanged — an order, a `provider: "free"` payment, an entitlement and a
 * licence key, exactly as paying £0 through `/checkout` produces today — so the
 * item appears in My Scripts and the licence works like any other.
 *
 * ## Three states, because two of them are not failures
 *
 * Signed out is a link, not a disabled button: claiming needs a session and an
 * active organisation (the download route authorises against both), and saying so
 * up front beats a refusal after the click.
 *
 * Already owned is not an error either — the action answers with the same href
 * rather than minting a second order, and the button says so.
 */
export function GetItFree({
  productId,
  licencePackageKey,
  signedIn,
  owned,
  productPath,
  disabled,
}: {
  productId: string;
  licencePackageKey?: string;
  signedIn: boolean;
  owned: boolean;
  /** Where to come back to after signing in. */
  productPath: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const className =
    "bg-foreground text-background flex items-center justify-center gap-2 rounded-full px-5 py-3 text-[14px] font-medium transition hover:opacity-90 disabled:opacity-50";

  if (!signedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(productPath)}` as Route}
        className={className}
      >
        <Download className="size-4" aria-hidden />
        Sign in to download for free
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={pending || disabled}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await claimFreeProductAction({
              productId,
              ...(licencePackageKey ? { licencePackageKey } : {}),
            });

            if (!result.ok) {
              setError(result.error);
              return;
            }

            setDone(true);
            /*
             * A document navigation, not `router.push`.
             *
             * The href is `/api/downloads/<id>`, a Route Handler that answers 307
             * to a short-lived presigned S3 URL. Handing that to the client router
             * fetches it as a payload instead of letting the browser follow the
             * redirect and save the file. `assign` keeps history, so Back returns
             * to the product page.
             */
            window.location.assign(result.data.href);
          });
        }}
        className={className}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : done ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
        {owned ? "Download again" : pending ? "Preparing…" : "Download for Free"}
      </button>

      {error && (
        <p role="alert" className="text-[12.5px] text-[var(--danger)]">
          {error}
        </p>
      )}

      <p className="text-subtle text-center text-[12px]">
        {owned
          ? "Already in your My Scripts."
          : "Nothing to pay. It goes to My Scripts with its licence key."}
      </p>
    </div>
  );
}
