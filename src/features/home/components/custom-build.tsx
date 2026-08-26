import Link from "next/link";
import { Check } from "lucide-react";
import { Band, Eyebrow } from "./band";
import { CUSTOM_BUILD_PROMISES } from "../data";

/**
 * "Can't find exactly what you need?" — the custom-build conversion band.
 *
 * ## A real form, and it carries their words
 *
 * The input is a plain `<form method="get" action="/custom-software">`, so it
 * works with JavaScript off and satisfies the CSP's `form-action 'self'`. What the
 * visitor types arrives in the assistant's textarea **unsent** — they press send.
 *
 * Prefilled rather than auto-sent for two reasons. A `GET` that created a message
 * would mean a crawler following a shared `?brief=…` link wrote rows; and someone
 * who typed six words into a homepage box has not yet decided that is their
 * opening message. Landing with it there, editable, is the honest version.
 *
 * ## The promises are the design
 *
 * This band absorbs the old "Requirements assistant" section, which was a large
 * mock of a requirements document beside two `<button>`s that had no handlers —
 * decorative controls in a Server Component. What was worth keeping is the three
 * commitments, because they are what makes an AI intake trustworthy to somebody
 * who has been burned by one.
 */
export function CustomBuild() {
  return (
    <Band id="custom-build">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-6">
          <Eyebrow>Custom build</Eyebrow>
          <h2 className="mt-3.5 max-w-[20ch] text-[clamp(1.9rem,4.5vw,3.2rem)] leading-[1] font-semibold tracking-[-0.04em] text-balance">
            Can&rsquo;t find exactly what you need?
          </h2>
          <p className="text-muted-foreground mt-5 max-w-[48ch] text-[16px] leading-relaxed">
            Tell us what your business needs to do — in your words, not ours. No technical
            specification, no stack decisions, no forty-field brief. We work out what it needs
            to be, then scope and quote it.
          </p>

          <ul className="mt-8 flex flex-col gap-2.5">
            {CUSTOM_BUILD_PROMISES.map((promise) => (
              <li
                key={promise}
                className="border-border bg-surface flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-[14.5px]"
              >
                <span className="bg-signal-soft mt-0.5 grid size-5 shrink-0 place-items-center rounded-full">
                  <Check className="text-signal-text size-3" strokeWidth={3} aria-hidden />
                </span>
                {promise}
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-6">
          <div className="shadow-lift border-border bg-surface rounded-[26px] border p-5 lg:p-7">
            <form action="/custom-software" method="get" className="flex flex-col gap-4">
              <label htmlFor="brief" className="text-[15px] font-medium">
                What are you looking to build?
              </label>

              <textarea
                id="brief"
                name="brief"
                rows={5}
                maxLength={600}
                placeholder="We run a care agency and need to plan staff shifts, track visits and send invoices to the council."
                className="border-border bg-background focus-visible:border-border-strong min-h-[128px] w-full resize-y rounded-2xl border px-4 py-3.5 text-[14.5px] leading-relaxed outline-none"
              />

              <button
                type="submit"
                className="bg-signal text-signal-contrast w-fit rounded-full px-6 py-3 text-[14px] font-medium transition hover:opacity-90"
              >
                Start a custom request
              </button>

              <p className="text-subtle text-[12.5px] leading-relaxed">
                You don&rsquo;t need an account to start, and nothing is sent until you&rsquo;ve
                read back what we understood.
              </p>
            </form>
          </div>

          <p className="text-muted-foreground mt-5 text-[13.5px]">
            Already found something close?{" "}
            <Link href="/marketplace" className="text-signal-text underline underline-offset-4">
              Start from an existing product
            </Link>{" "}
            and have it changed instead — it is cheaper and faster than building from nothing.
          </p>
        </div>
      </div>
    </Band>
  );
}
