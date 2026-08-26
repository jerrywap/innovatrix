import Image from "next/image";
import { Check } from "lucide-react";
import { MoneyDisplay } from "@/components/money-display";
import { money } from "@/lib/money";
import { JOURNEY, MOCK_ACCOUNT } from "../../sell-data";

/**
 * The hero illustration — a vendor account, as it would actually look.
 *
 * ## Believable figures, inside an obvious mock
 *
 * The first version of this panel used grey skeleton bars, on the reasoning that a
 * figure would be a claim about what vendors earn and nobody has measured that. The
 * reasoning was right and the result was wrong: it read as unfinished SaaS chrome,
 * which tells a developer nothing except that the page is a template.
 *
 * So the numbers are back, and the safeguard moved. They live inside a drawn
 * dashboard that is `aria-hidden` and framed as a screen, never as page copy — a
 * picture of *how being paid works*, not a statistic the page asserts. Every real
 * claim on this page is in text beside it, and none of them is a number about
 * earnings. See `MOCK_ACCOUNT` for the same note at the data.
 *
 * ## Chrome from tokens, content from committed assets
 *
 * Same split as the homepage hero: panels, frame and badges are composed from the
 * design tokens so they are theme-aware and weigh nothing, while the product
 * thumbnails are the real `public/brand/` screenshots — actual software interfaces
 * rather than ecommerce photography, which is what makes the row read as a
 * catalogue.
 *
 * ## No FREE badge here
 *
 * The marketplace has genuinely free listings and the homepage says so. This page is
 * establishing that a vendor's software has commercial value, and a FREE pill in the
 * one panel arguing that undercuts it. Free is a customer-acquisition story and
 * belongs on the pages aimed at customers.
 */
export function EarningsSurface() {
  const currency = MOCK_ACCOUNT.currency;

  return (
    <div
      className="relative mx-auto w-full max-w-[440px] lg:max-w-none"
      // Decorative in full: every claim it illustrates is made as real text alongside.
      aria-hidden
    >
      {/* earnings */}
      <div className="shadow-lift border-border bg-surface rounded-[26px] border p-5">
        <div className="flex items-center justify-between pb-4">
          <span className="text-subtle font-mono text-[10px] tracking-[0.16em] uppercase">
            Earnings
          </span>
          <span className="text-subtle font-mono text-[10px]">{currency}</span>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col">
            <MoneyDisplay
              value={money(MOCK_ACCOUNT.available, currency)}
              className="font-display text-[26px] leading-none tracking-[-0.03em] tabular-nums"
            />
            <span className="text-muted-foreground mt-1.5 text-[12px]">Available</span>
          </div>
          <div className="flex flex-col items-end">
            <MoneyDisplay
              value={money(MOCK_ACCOUNT.clearing, currency)}
              className="text-muted-foreground text-[15px] tabular-nums"
            />
            <span className="text-subtle mt-1.5 text-[12px]">Clearing</span>
          </div>
        </div>

        {/*
          Cleared against clearing, as one bar rather than a chart. It carries the
          same information as the two figures above it and needs no axis, no legend
          and no library.
        */}
        <div className="bg-surface-muted mt-4 flex h-1.5 overflow-hidden rounded-full">
          <span className="bg-foreground/75 h-full w-[81%]" />
          <span className="bg-border-strong h-full flex-1" />
        </div>

        <div className="border-border mt-4 flex items-center justify-between border-t pt-3.5">
          <span className="text-muted-foreground text-[12.5px]">Next payout</span>
          <span className="text-[12.5px] font-medium tabular-nums">
            {MOCK_ACCOUNT.nextPayout}
          </span>
        </div>
      </div>

      {/* the products earning it */}
      <div className="shadow-float border-border bg-surface relative z-10 mt-[-14px] ml-auto w-[94%] overflow-hidden rounded-[26px] border sm:mt-[-18px] lg:w-[90%]">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <span className="text-subtle font-mono text-[10px] tracking-[0.16em] uppercase">
            Your products
          </span>
          <span className="text-subtle font-mono text-[10px]">On sale</span>
        </div>

        <div className="divide-border divide-y">
          {MOCK_ACCOUNT.products.map((product) => (
            <div key={product.name} className="flex items-center gap-3 p-3.5">
              <span className="border-border bg-surface-muted relative size-10 shrink-0 overflow-hidden rounded-lg border">
                <Image src={product.shot} alt="" fill sizes="40px" className="object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{product.name}</span>
                <span className="text-subtle block truncate text-[11.5px]">
                  {product.category}
                </span>
              </span>
              <MoneyDisplay
                value={money(product.price, currency)}
                className="shrink-0 text-[13px] font-medium tabular-nums"
              />
            </div>
          ))}
        </div>
      </div>

      {/*
        The journey, as a row beneath the panels rather than floating over them.

        The homepage cascades its three pills across the hero illustration, and that
        works there because what they overlap is a wireframe — grey bars with nothing
        to read. Here they would sit on product names, prices and thumbnails, which is
        the one part of this panel doing the actual arguing. So they moved below and
        gained a connector: same three beats, same restraint, nothing obscured.
      */}
      <div className="mt-7 flex items-center gap-2">
        {JOURNEY.map((step, index) => (
          <div key={step} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden className="bg-border-strong h-px w-4 sm:w-6" />}
            <span className="border-border bg-surface shadow-lift flex items-center gap-2 rounded-full border py-2 pr-3.5 pl-2.5">
              <span className="bg-signal-soft grid size-5 shrink-0 place-items-center rounded-full">
                <Check className="text-signal-text size-[11px]" strokeWidth={3} />
              </span>
              <span className="text-[12px] font-medium whitespace-nowrap">{step}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
