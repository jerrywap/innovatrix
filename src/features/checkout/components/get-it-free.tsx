"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Check, Download, Loader2 } from "lucide-react";
import { claimFreeProductAction } from "../actions";
import { TipDialog } from "@/features/tips/components/tip-dialog";

/**
 * Set on a successful claim, read after the refresh it causes.
 *
 * `sessionStorage` rather than component state because the claim revalidates the
 * route, which remounts this component — see the click handler.
 */
const TIP_PENDING = "cosetup:tip-after-download";

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
  signInHref,
  destinationLabel,
  disabled,
  tip,
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
  /**
   * The tip offer, shown **after** the download starts — see the click handler.
   *
   * Absent on a first-party product and for any viewer who cannot be charged, so
   * this component never decides either; `purchase-section.tsx` did.
   */
  tip?: {
    productName: string;
    vendorName: string;
    commissionBasisPoints: number;
    currency: string;
    options: ReadonlyArray<{ currency: string; presets: readonly number[] }>;
  };
  /** Where to come back to after signing in. */
  /**
   * Where a signed-out visitor is sent to sign in — supplied by the server.
   *
   * This was `loginPath(productPath)`, built right here. That is correct for a
   * visitor with no cookie and **inert** for one holding an expired cookie: the
   * proxy reads cookie presence rather than validity, so it bounces
   * `/login?next={this page}` back to this page and the click does nothing.
   * Only the server can tell those two apart, so only the server may build this.
   */
  signInHref: string;
  /** What the destination list is called — one name, from `navigation.ts`. */
  destinationLabel: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);

  /*
   * Reopen the ask after the refresh that the claim triggered.
   *
   * Runs on mount, which is exactly once per remount — and a remount is what
   * `revalidatePath` causes. The flag is cleared as it is read, so a second
   * refresh, a Back navigation or another product's page does not inherit it.
   */
  useEffect(() => {
    if (!tip) return;

    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(TIP_PENDING);
      if (pending) sessionStorage.removeItem(TIP_PENDING);
    } catch {
      return;
    }
    if (pending !== productId) return;

    /*
     * Opened from a timer rather than straight from the effect body.
     *
     * Two reasons, and they agree. `react-hooks/set-state-in-effect` objects to a
     * synchronous setState in an effect — a cascading render — and allows one
     * from a callback. And the delay is wanted anyway: the browser's own download
     * chrome appears first, so the dialog reads as a thank-you rather than as the
     * thing that took the click.
     */
    const timer = setTimeout(() => setTipOpen(true), 900);
    return () => clearTimeout(timer);
  }, [tip, productId]);

  const className =
    "bg-foreground text-background flex items-center justify-center gap-2 rounded-full px-5 py-3 text-[14px] font-medium transition hover:opacity-90 disabled:opacity-50";

  if (viewer === "signed-out") {
    return (
      <Link href={signInHref as Route} className={className}>
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
      {tip && (
        <TipDialog
          open={tipOpen}
          onOpenChange={setTipOpen}
          productId={productId}
          productName={tip.productName}
          vendorName={tip.vendorName}
          currency={tip.currency}
          options={tip.options}
          commissionBasisPoints={tip.commissionBasisPoints}
        />
      )}

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

            /*
             * The ask, once the file is already on its way — **through
             * `sessionStorage`, not through state.**
             *
             * `assign` to `/api/downloads/…` does not navigate: the route answers
             * 307 to a presigned URL served `Content-Disposition: attachment`, so
             * the browser saves the file and leaves the page standing. That is
             * what makes this moment available at all, and why the prompt can
             * never be mistaken for a gate on the download.
             *
             * What *does* happen is a refresh: the action calls
             * `revalidatePath("/", "layout")` so the button can say "Download
             * again", and that remounts this component. A `setTimeout` closing
             * over `setTipOpen` therefore fired into a dead instance and the
             * dialog never appeared — measured, after watching the button change
             * and nothing else happen.
             *
             * A flag outlives the remount, and the effect below picks it up on
             * the way back. It also survives the case where the href is a page
             * rather than a file, which is what an entitlement with no package
             * returns.
             */
            if (tip) {
              try {
                sessionStorage.setItem(TIP_PENDING, productId);
              } catch {
                // Private windows and blocked site data. The download already
                // happened; losing the thank-you prompt is the right thing to
                // lose.
              }
            }
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
