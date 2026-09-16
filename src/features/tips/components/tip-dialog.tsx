"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoneyDisplay } from "@/components/money-display";
import { money } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useManualSubmit } from "@/features/products/components/section-form";
import { createTipAction, dismissTipPromptAction } from "../actions";

/**
 * "Say thanks", offered once, after a download has started.
 *
 * ## Why after, and not before
 *
 * The file is already saving by the time this opens, so nothing about the ask
 * gates the thing they came for. A tip prompt that stands between somebody and
 * their download is a paywall wearing a heart icon.
 *
 * ## Why the split is on the screen
 *
 * Because CoSetup takes its usual commission on a tip. A modal that says "support
 * the maker" over a button that quietly keeps a share is the sort of thing that
 * is only ever discovered afterwards, by the wrong person. One line, stated
 * plainly, and the figure the vendor is told they earned is the figure the tipper
 * was shown.
 *
 * ## Three presets and a custom box
 *
 * Presets are round numbers in the viewer's own currency — never converted, which
 * is how you end up offering somebody ₦10,342. The fourth option is a free
 * amount, because the three will always be wrong for somebody.
 */
export function TipDialog({
  open,
  onOpenChange,
  productId,
  productName,
  vendorName,
  entitlementId,
  currency,
  options,
  commissionBasisPoints,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  productId: string;
  productName: string;
  vendorName: string;
  /** Present when the prompt was triggered by owning something — lets it be silenced. */
  entitlementId?: string;
  /** What the viewer browses in. May not be one we can charge — see `options`. */
  currency: string;
  /**
   * The currencies a tip can actually be taken in. Empty means none can.
   *
   * Handed down rather than discovered at submit: a provider being off is a
   * setting somebody else changed, and the old version found out about it by
   * failing under a button the tipper had already pressed.
   */
  options: ReadonlyArray<{ currency: string; presets: readonly number[] }>;
  commissionBasisPoints: number;
}) {
  /*
   * The currency the tip is actually in.
   *
   * Defaults to the viewer's own when we can charge it, and otherwise to the
   * first one we can — so the common case needs no decision and the awkward case
   * still opens on something usable rather than on a dead end.
   */
  const usable = options.some((option) => option.currency === currency);
  const [active, setActive] = useState(() =>
    usable ? currency : (options[0]?.currency ?? currency),
  );

  const chosenOption = options.find((option) => option.currency === active);
  const presets = chosenOption?.presets ?? [];

  const [amount, setAmount] = useState<number>(presets[1] ?? presets[0] ?? 0);
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const { state, pending, onSubmit } = useManualSubmit(createTipAction);
  const failed = state && !state.ok ? state : null;

  /*
   * A successful action returns a provider URL rather than redirecting.
   *
   * `redirect()` inside the action would hand the provider's page to the RSC
   * router, which is not what sends somebody to a payment page — the same reason
   * `claimFreeProductAction` returns an href. A plain document navigation is the
   * one that works.
   */
  if (state?.ok && "redirectUrl" in state.data) {
    const { redirectUrl } = state.data as { redirectUrl: string };
    if (typeof window !== "undefined") window.location.assign(redirectUrl);
  }

  const chosen = showCustom ? Math.round(Number(custom) * 100) : amount;
  const valid = Number.isFinite(chosen) && chosen > 0;
  const earned = valid ? Math.floor((chosen * (10_000 - commissionBasisPoints)) / 10_000) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(100%,440px)] flex-col gap-0 p-0 sm:max-w-[440px]">
        <DialogHeader className="border-border border-b px-5 py-4 text-left">
          <DialogTitle className="font-display flex items-center gap-2 text-[17px] tracking-[-0.02em]">
            <Heart className="size-4 text-[var(--signal)]" aria-hidden />
            Enjoying {productName}?
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {vendorName} built it. Sending something is optional and they see who it came from.
          </DialogDescription>
        </DialogHeader>

        {/*
          Nothing configured at all — say so, and do not draw a form.

          This is the state a fresh environment is in, and the honest answer is
          not a disabled button: there is nothing the person can do here, and the
          screen should cost them one sentence rather than a decision.
        */}
        {options.length === 0 ? (
          <div className="flex flex-col gap-4 p-5">
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              Tips aren&rsquo;t available at the moment — we can&rsquo;t take payment in any
              currency right now. Nothing is wrong with your download.
            </p>
            <DialogFooter className="mx-0 mb-0 flex-row items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="bg-foreground text-background rounded-full px-5 py-2.5 text-[14px] font-medium transition hover:opacity-90"
              >
                Close
              </button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="amount" value={valid ? chosen : ""} />
            {/* The currency is posted, and re-checked server-side against the same
              payable list this screen was built from. */}
            <input type="hidden" name="currency" value={active} />

            {/*
            The switch, offered only when the viewer's own currency is one we
            cannot charge.

            Somebody browsing in GBP with no GBP provider used to choose an
            amount, press the button and meet "We can't take payment in GBP at
            the moment" — a dead end on a screen whose entire purpose is goodwill.
            Now the dialog opens on a currency that works and says why it changed.
            A viewer whose own currency is fine sees none of this.
          */}
            {!usable && options.length > 0 && (
              <div className="border-border bg-surface-muted/40 flex flex-col gap-2 rounded-xl border p-3">
                <p className="text-muted-foreground text-[12.5px] leading-relaxed">
                  We can&rsquo;t take {currency} right now, so this tip is in{" "}
                  <span className="text-foreground font-medium">{active}</span>.
                </p>
                {options.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {options.map((option) => (
                      <button
                        key={option.currency}
                        type="button"
                        onClick={() => {
                          setActive(option.currency);
                          // The old amount was in the old currency; carrying the
                          // number across would offer ₦5 or £250,000.
                          setAmount(option.presets[1] ?? option.presets[0] ?? 0);
                          setShowCustom(false);
                          setCustom("");
                        }}
                        aria-pressed={active === option.currency}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[12px] font-medium transition",
                          active === option.currency
                            ? "bg-signal-soft text-signal-text border-[var(--signal)]"
                            : "border-border hover:bg-surface",
                        )}
                      >
                        {option.currency}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setAmount(preset);
                    setShowCustom(false);
                  }}
                  aria-pressed={!showCustom && amount === preset}
                  className={cn(
                    "flex-1 rounded-xl border px-3 py-2.5 text-[14px] font-medium transition",
                    !showCustom && amount === preset
                      ? "bg-signal-soft text-signal-text border-[var(--signal)]"
                      : "border-border hover:bg-surface-muted",
                  )}
                >
                  <MoneyDisplay value={money(preset, active as never)} />
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                aria-pressed={showCustom}
                className={cn(
                  "flex-1 rounded-xl border px-3 py-2.5 text-[14px] font-medium transition",
                  showCustom
                    ? "bg-signal-soft text-signal-text border-[var(--signal)]"
                    : "border-border hover:bg-surface-muted",
                )}
              >
                Other
              </button>
            </div>

            {showCustom && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">How much?</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  autoFocus
                  className="border-border bg-surface focus-visible:ring-ring rounded-xl border px-3 py-2.5 text-[14px] focus-visible:ring-2 focus-visible:outline-none"
                  placeholder="10.00"
                />
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">
                Add a note <span className="text-subtle font-normal">(optional)</span>
              </span>
              <input
                name="note"
                maxLength={280}
                className="border-border bg-surface focus-visible:ring-ring rounded-xl border px-3 py-2.5 text-[14px] focus-visible:ring-2 focus-visible:outline-none"
                placeholder="Saved me a week of work."
              />
            </label>

            {/*
            Said before they commit, not in a receipt afterwards. The figure on
            the right is the one the vendor's earnings screen will show.
          */}
            {valid && (
              <p className="text-muted-foreground text-[12.5px]">
                <MoneyDisplay value={money(earned, active as never)} /> of this reaches{" "}
                {vendorName}; CoSetup keeps its usual{" "}
                {(commissionBasisPoints / 100).toFixed(commissionBasisPoints % 100 ? 1 : 0)}%,
                the same as on a sale.
              </p>
            )}

            {failed && (
              <p role="alert" className="text-destructive text-[13px]">
                {failed.error}
              </p>
            )}

            <DialogFooter className="mx-0 mb-0 flex-row items-center justify-between gap-2 pt-1">
              <DismissButton entitlementId={entitlementId} onDone={() => onOpenChange(false)} />
              <button
                type="submit"
                disabled={!valid || pending}
                className="bg-foreground text-background rounded-full px-5 py-2.5 text-[14px] font-medium transition hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Taking you to pay…" : "Send a tip"}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Not this time" — and, when we know which purchase this was, never again for it.
 *
 * Without an `entitlementId` there is nothing to remember against, so it just
 * closes. That is the product-page case, where the prompt is opened deliberately
 * rather than offered.
 */
function DismissButton({
  entitlementId,
  onDone,
}: {
  entitlementId?: string;
  onDone: () => void;
}) {
  const { pending, onSubmit } = useManualSubmit(dismissTipPromptAction);

  if (!entitlementId) {
    return (
      <button
        type="button"
        onClick={onDone}
        className="text-muted-foreground hover:text-foreground text-[13px]"
      >
        Not this time
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        onSubmit(event);
        onDone();
      }}
    >
      <input type="hidden" name="entitlementId" value={entitlementId} />
      <button
        type="submit"
        disabled={pending}
        className="text-muted-foreground hover:text-foreground text-[13px]"
      >
        Not this time
      </button>
    </form>
  );
}
