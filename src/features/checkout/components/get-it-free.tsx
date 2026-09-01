"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Download, Loader2 } from "lucide-react";
import { loginPath } from "@/lib/return-path";
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
 * item appears in the buyer's purchases and the licence works like any other.
 *
 * ## Four states, because three of them are not failures
 *
 * Signed out is a link, not a disabled button: claiming needs a session and an
 * active organisation (the download route authorises against both), and saying so
 * up front beats a refusal after the click.
 *
 * **The organisation half of that sentence was never built**, and it showed. A
 * viewer with a session but no organisation got the button, pressed it, and read
 * `requireOrg`'s internal sentence in red underneath — "No active organization for
 * this session." That state is not rare and not always broken: **staff correctly
 * have no organisation** and browse the public marketplace, and the 60-second
 * session cookie cache reaches it for a customer whose account is fine.
 *
 * So the two are told apart, because the honest answer differs. Staff are not
 * customers and never will hold a licence; a half-built customer account is one
 * button away from working, and that button already exists on the dashboard.
 * Neither of them should meet a refusal after a click.
 *
 * Already owned is not an error either — the action answers with the same href
 * rather than minting a second order, and the button says so.
 */
export function GetItFree({
  productId,
  licencePackageKey,
  viewer,
  owned,
  productPath,
  destinationLabel,
  disabled,
}: {
  productId: string;
  licencePackageKey?: string;
  /**
   * Who is looking, in the only four kinds that change what this renders.
   *
   * A union rather than the `signedIn` boolean it replaces, because the server
   * already knows which of these it is — `purchase-section.tsx` reads
   * `activeOrganizationId` and `isStaff` on the line above — and passing two
   * booleans would let a caller state a combination that cannot exist.
   */
  viewer: "signed-out" | "staff" | "no-organisation" | "customer";
  owned: boolean;
  /** Where to come back to after signing in. */
  productPath: string;
  /** What the destination list is called — one name, from `navigation.ts`. */
  destinationLabel: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const className =
    "bg-foreground text-background flex items-center justify-center gap-2 rounded-full px-5 py-3 text-[14px] font-medium transition hover:opacity-90 disabled:opacity-50";

  if (viewer === "signed-out") {
    return (
      <Link href={loginPath(productPath)} className={className}>
        <Download className="size-4" aria-hidden />
        Sign in to download for free
      </Link>
    );
  }

  /*
   * Staff, who are not customers.
   *
   * No CTA at all rather than a disabled one: a greyed "Download for Free" invites
   * somebody to work out what is wrong with their account, and nothing is. Staff
   * hold no licences by design — the same reason `dashboard/layout.tsx` sends them
   * to `/staff` instead of a customer dashboard.
   */
  if (viewer === "staff") {
    return (
      <p className="text-subtle text-center text-[12.5px]">
        Staff accounts don&rsquo;t hold licences. Sign in with a customer account to download
        this.
      </p>
    );
  }

  /*
   * A customer account that never finished being set up.
   *
   * The repair is a button on the dashboard and it takes one press, so this is a
   * link to it rather than an apology — and `completeAccountSetupAction` returns
   * them here afterwards, because the destination is parked on the way.
   */
  if (viewer === "no-organisation") {
    return (
      <div className="flex flex-col gap-1.5">
        <Link href="/dashboard" className={className}>
          <Download className="size-4" aria-hidden />
          Finish setting up your account
        </Link>
        <p className="text-subtle text-center text-[12px]">
          One step, then this is yours for nothing.
        </p>
      </div>
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
        {/*
          The destination is named once, in `navigation.ts`, and passed in. It was
          hardcoded "My Scripts" here — on a page that is just as often a website
          template, pointing at a list that holds both.
        */}
        {owned
          ? `Already in your ${destinationLabel}.`
          : `Nothing to pay. It goes to your ${destinationLabel} with its licence key.`}
      </p>
    </div>
  );
}
