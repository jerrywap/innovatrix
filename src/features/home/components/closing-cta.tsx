import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";

/**
 * The close — four routes back into the four intents.
 *
 * The previous version was a single large "Tell us what your business needs to
 * do" slab pointing at the custom-build flow, which made it the third band in a
 * row to do so and left a visitor whose answer was "I just want the CRM" with
 * nowhere obvious to go. The brief asks the close to reopen all four paths, so it
 * lists them — and the dark treatment moved to the vendor band, since two inverse
 * slabs in the last three bands is one too many.
 */
const EXITS = [
  { href: "/marketplace" as Route, label: "Applications & scripts", hint: "Buy and install" },
  { href: "/templates" as Route, label: "Website templates", hint: "Put a front-end live" },
  { href: "/custom-software" as Route, label: "Custom build", hint: "Describe the outcome" },
  { href: "/sell" as Route, label: "Sell on CoSetup", hint: "List what you built" },
] as const;

export function ClosingCta() {
  return (
    <section className="px-5 pb-20 lg:px-10 lg:pb-28">
      <div className="border-border mx-auto max-w-[1400px] border-t pt-14 lg:pt-20">
        <h2 className="max-w-[24ch] text-[clamp(1.75rem,4.2vw,3rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance">
          Start with what exists. Build what&rsquo;s missing.
        </h2>

        <ul className="mt-10 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {EXITS.map((exit) => (
            <li key={exit.href}>
              <Link
                href={exit.href}
                className="group border-border bg-surface hover:border-border-strong flex items-center justify-between gap-3 rounded-[18px] border px-4 py-4 transition"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-medium">{exit.label}</span>
                  <span className="text-subtle block text-[12.5px]">{exit.hint}</span>
                </span>
                <ArrowRight
                  className="text-subtle size-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
