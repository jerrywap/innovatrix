import Link from "next/link";
import { Band } from "@/components/band";
import { VENDOR_FAMILIES } from "../data";

/**
 * "You build software. We help you sell it."
 *
 * ## Visually distinct on purpose
 *
 * The one inverse band on the page. That is not decoration: this is the only
 * section addressed to a *different audience*, and a developer scanning the page
 * for whether there is anything here for them needs one block that reads
 * differently from everything above it. The brief also names the failure mode this
 * fixes — the sell path used to exist only as a footer link.
 *
 * It sits second-to-last, so it never competes with buyer intent, and its two
 * actions are the real ones: `/sell` explains it, `/terms/vendor` is what they
 * actually sign. The authenticated application form lives behind `/sell`, which is
 * where a signed-out visitor should meet it.
 *
 * No revenue share, payout figure or vendor count is stated. We would be inventing
 * all three.
 */
export function Vendor() {
  return (
    <Band id="sell" tone="inverse">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(600px 320px at 78% 12%, var(--signal-soft), transparent 70%)",
        }}
      />

      <div className="relative grid gap-10 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-7">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase opacity-60">
            For developers &amp; studios
          </p>
          <h2 className="mt-3.5 max-w-[20ch] text-[clamp(1.9rem,5vw,3.4rem)] leading-[1] font-semibold tracking-[-0.04em] text-balance">
            You build software. We help you sell it.
          </h2>
          <p className="mt-5 max-w-[52ch] text-[15.5px] leading-relaxed opacity-75">
            List what you have already built and we handle the commercial half checkout,
            licensing, delivery and the customer relationship. You keep building.
          </p>

          <ul className="mt-7 flex flex-wrap gap-2">
            {VENDOR_FAMILIES.map((family) => (
              <li
                key={family}
                className="rounded-full border border-current/20 px-3.5 py-1.5 text-[12.5px] opacity-80"
              >
                {family}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row lg:col-span-5 lg:flex-col lg:items-end">
          <Link
            href="/sell"
            className="bg-signal text-signal-contrast rounded-full px-7 py-3.5 text-center text-[14.5px] font-medium transition hover:opacity-90"
          >
            Start selling
          </Link>
          <Link
            href="/terms/vendor"
            className="rounded-full border border-current/25 px-7 py-3.5 text-center text-[14.5px] font-medium opacity-80 transition hover:opacity-100"
          >
            Read the vendor agreement
          </Link>
        </div>
      </div>
    </Band>
  );
}
