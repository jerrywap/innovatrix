"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ScrollText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VENDOR_AGREEMENT_SECTIONS } from "../agreement";

/**
 * Accepting the vendor agreement, by reading it.
 *
 * ## Why this is not a checkbox
 *
 * It was one, beside a link to `/terms/vendor` — and a tick recorded against a
 * document nobody opened is thin evidence. `assertAgreementCurrent` and ticket
 * 13's takedown flow both lean on this acceptance, so what is worth recording is
 * that the applicant *had the text in front of them*. Ticking a box next to a
 * link does not establish that; scrolling to the end of the text does, about as
 * well as a web form ever can.
 *
 * So the control opens the agreement, and the accept button inside is disabled
 * until the reader reaches the bottom. Nothing here is a security boundary — the
 * form posts `acceptAgreement` and a determined person can post it by hand. It is
 * a record-keeping and a fairness measure, and it is honest about being one.
 *
 * ## The submitted value is a hidden input
 *
 * Not the visible control, and deliberately: React state is the source of truth,
 * so the value cannot be flipped by anything that reaches into the DOM — which
 * includes the pre-action form reset that `section-form.tsx` documents at length.
 * A Radix `Checkbox` here would answer that reset by restoring its mount-time
 * ref, silently un-accepting an agreement the applicant had read in full.
 *
 * ## Scroll detection
 *
 * `scrollTop + clientHeight >= scrollHeight - 24`. The tolerance is not
 * cosmetic: sub-pixel layout, a fractional device pixel ratio and a bottom
 * margin all conspire to leave the sum a pixel or two short of `scrollHeight`,
 * and an exact comparison produces a button that never enables while the reader
 * is plainly at the end.
 *
 * The check also runs **on open**, because a short agreement on a tall screen
 * never scrolls at all — with only a scroll listener the accept button would be
 * permanently disabled and the application impossible to submit. That is a
 * failure mode a longer document hides, which is exactly the kind that ships.
 */
export function AgreementGate({
  name,
  version,
  required = true,
}: {
  /** Form field name. The action expects the literal `"on"`. */
  name: string;
  version: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [read, setRead] = useState(false);

  const scroller = useRef<HTMLDivElement | null>(null);

  const checkScrolled = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 24) setRead(true);
  }, []);

  // On open: the panel has just mounted, so measure it once. Covers the short
  // document that never scrolls, and restores the enabled state for somebody
  // reopening an agreement they already read.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(checkScrolled);
    return () => cancelAnimationFrame(frame);
  }, [open, checkScrolled]);

  return (
    <div className="flex flex-col gap-2.5">
      {/*
        The value the server sees. `required` on a hidden input would block
        submission with a validation message pointing at something invisible, so
        the requirement is enforced by the schema (`z.literal("on")`) and
        surfaced as a field error like any other.
      */}
      {accepted && <input type="hidden" name={name} value="on" />}

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-describedby="agreement-state"
        className={`border-border hover:bg-surface-muted flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
          accepted ? "border-[var(--signal)]" : ""
        }`}
      >
        <span
          aria-hidden
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[6px] border ${
            accepted
              ? "border-[var(--signal)] bg-[var(--signal)] text-[var(--signal-contrast)]"
              : "border-border-strong"
          }`}
        >
          {accepted ? <Check className="size-3.5" strokeWidth={3} /> : null}
        </span>

        <span className="flex flex-col gap-1">
          <span className="text-[13.5px] leading-relaxed font-medium">
            {accepted
              ? "You accepted the CoSetup vendor agreement"
              : "Read and accept the CoSetup vendor agreement"}
            {required && !accepted && <span className="text-[var(--signal-text)]"> *</span>}
          </span>
          <span className="text-muted-foreground flex items-center gap-1.5 text-[12.5px]">
            <ScrollText className="size-3.5" aria-hidden />
            {accepted ? "Read it again" : "Opens the full text — read to the end to accept"}
            <span className="text-subtle font-mono text-[11px]">({version})</span>
          </span>
        </span>
      </button>

      {/*
        A live region rather than a second sentence in the button: the button's
        own label already changes, and a screen reader announcing the whole
        control again on every toggle is noisier than announcing the outcome.
      */}
      <p id="agreement-state" role="status" className="sr-only">
        {accepted ? "Vendor agreement accepted." : "Vendor agreement not yet accepted."}
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex max-h-[86vh] w-[min(100%,780px)] flex-col gap-0 p-0 sm:max-w-[780px]"
          showCloseButton={false}
        >
          <DialogHeader className="border-border border-b px-6 py-5 text-left">
            <DialogTitle className="font-display text-[19px] tracking-[-0.02em]">
              CoSetup vendor agreement
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              Version <span className="font-mono">{version}</span>. This is the text your
              acceptance is recorded against.
            </DialogDescription>
          </DialogHeader>

          {/*
            `tabIndex={0}` so the panel is focusable and therefore scrollable by
            keyboard. Without it a keyboard user can Tab to the accept button and
            to nothing else, and has no way to reach the bottom of the text that
            the button is waiting for — the gate would lock them out of the
            application entirely.
          */}
          <div
            ref={scroller}
            onScroll={checkScrolled}
            tabIndex={0}
            role="region"
            aria-label="Vendor agreement text"
            className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 py-6 focus-visible:outline-none"
          >
            {VENDOR_AGREEMENT_SECTIONS.map((section, index) => (
              <section key={section.heading} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-subtle font-mono text-[10px] tracking-[0.2em]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-display text-[15px] font-semibold tracking-[-0.02em]">
                    {section.heading}
                  </h3>
                </div>
                <div className="flex flex-col gap-2.5 sm:pl-8">
                  {section.body.map((paragraph) => (
                    <p
                      key={paragraph.slice(0, 40)}
                      className="text-muted-foreground max-w-[68ch] text-[13.5px] leading-relaxed"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/*
            `mx-0 mb-0` cancels `DialogFooter`'s own `-mx-4 -mb-4`. Those negative
            margins exist to let the footer bleed to the edge of a `p-4`
            `DialogContent`; this content is `p-0`, so uncancelled they pull the
            bar four units *outside* the dialog. `cn` is tailwind-merge, so the
            later class wins its group — but only for a group that exists, which
            is why these are spelled out rather than assumed.
          */}
          <DialogFooter className="border-border mx-0 mb-0 flex-row items-center justify-between gap-3 border-t px-6 py-4">
            <p className="text-muted-foreground m-0 text-[12.5px]">
              {read ? "You've reached the end." : "Scroll to the end to accept."}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="border-border hover:bg-surface-muted rounded-full border px-4 py-2 text-[13px] font-medium transition"
              >
                Close
              </button>
              <button
                type="button"
                disabled={!read}
                onClick={() => {
                  setAccepted(true);
                  setOpen(false);
                }}
                className="rounded-full bg-[var(--signal)] px-5 py-2 text-[13px] font-medium text-[var(--signal-contrast)] transition disabled:cursor-not-allowed disabled:opacity-45"
              >
                I agree
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
