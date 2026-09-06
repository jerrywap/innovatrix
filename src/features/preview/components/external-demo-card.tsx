"use client";

import { ArrowUpRight } from "lucide-react";

/**
 * What a visitor sees instead of a blank rectangle when a demo's host refuses
 * to be framed — ticket 31.
 *
 * ## It never names the mechanism
 *
 * "This site blocks embedding" is true, is meaningless to a buyer who has never
 * heard of an iframe, and reads as *our* failure rather than a property of the
 * vendor's server. §8: plain language, and say what happens next rather than
 * what went wrong.
 *
 * The copy is also not a euphemism. "Best viewed in a new tab" would imply a
 * preference the visitor could ignore; the demo genuinely runs somewhere that
 * opens in its own tab, and saying so costs nothing and stays true.
 *
 * ## It is an invitation, not an error
 *
 * Signal fill, the same treatment the vendor surfaces give their primary action.
 * Styling this as a warning would tell a visitor that something is wrong with a
 * product whose demo works perfectly well one click away — which is the
 * misreading the whole ticket exists to stop.
 */
export function ExternalDemoCard({
  productName,
  url,
  targetLabel,
}: {
  productName: string;
  url: string;
  /**
   * "Customer" or "Admin" when the blocked target is one of the gated views, so
   * the card says which of them opens. Absent for the public demo, where naming
   * it would be noise.
   */
  targetLabel?: string;
}) {
  return (
    <div className="border-border bg-surface flex w-full max-w-[1180px] shrink-0 flex-col gap-3 rounded-xl border px-4 py-3.5 shadow-sm sm:flex-row sm:items-center sm:gap-5 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">Continue to the live demo</p>
        <p className="text-muted-foreground mt-0.5 text-[12.5px] leading-relaxed">
          {targetLabel
            ? `The ${targetLabel.toLowerCase()} view of ${productName}'s demo runs on the vendor's own site, which opens in its own tab.`
            : `${productName}'s demo runs on the vendor's own site, which opens in its own tab.`}
        </p>
      </div>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--signal)] px-5 py-2.5 text-[13px] font-medium text-[var(--signal-contrast)] transition hover:opacity-90"
      >
        {/*
          The product name is inside the accessible name rather than replacing it
          (WCAG 2.5.3), so "Explore Bankora" is both what is drawn and what is
          announced — and "opens in a new tab" extends it rather than standing in
          for it.
        */}
        Explore {productName}
        <ArrowUpRight className="size-4" aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  );
}
