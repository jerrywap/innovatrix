"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { TipDialog } from "./tip-dialog";

/**
 * "Say thanks" — the durable way to tip, on something you already own.
 *
 * ## Why this exists as well as the post-download prompt
 *
 * The prompt after a download is the good moment, and it is the *only* moment:
 * it fires once, a second after a click, and never again for that purchase. That
 * is right for an unprompted ask and useless as the only route — somebody who
 * dismissed it, or who decided a week later that the thing had saved them a day,
 * has nowhere to go.
 *
 * So the library card carries a standing control. Same dialog, same amounts, same
 * split; what differs is that this one was asked for.
 *
 * Renders nothing when the product has no vendor. A first-party listing has
 * nobody to thank, and `createTip` refuses one server-side for the same reason.
 */
export function TipButton({
  productId,
  productName,
  vendorName,
  currency,
  options,
  commissionBasisPoints,
}: {
  productId: string;
  productName: string;
  vendorName: string;
  currency: string;
  options: ReadonlyArray<{ currency: string; presets: readonly number[] }>;
  commissionBasisPoints: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition"
      >
        <Heart className="size-3.5" aria-hidden />
        Say thanks
        {/* The button's own text is two words; the name says who it reaches. */}
        <span className="sr-only">
          {" "}
          — send {vendorName} a tip for {productName}
        </span>
      </button>

      <TipDialog
        open={open}
        onOpenChange={setOpen}
        productId={productId}
        productName={productName}
        vendorName={vendorName}
        currency={currency}
        options={options}
        commissionBasisPoints={commissionBasisPoints}
      />
    </>
  );
}
