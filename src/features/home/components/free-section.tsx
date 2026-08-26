import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { FreeBadge } from "@/components/free-badge";
import { ProductCardTile } from "@/features/marketplace/components/product-card";
import { searchMarketplaceRows } from "@/services/marketplace";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { Band, SectionHead } from "@/components/band";

/**
 * "Start with something free."
 *
 * ## Premium, not a download repository
 *
 * The brief is careful here and so is this band: free is an acquisition layer
 * across the catalogue, never the master brand promise. So it gets the same cards
 * and the same typography as the paid bands — the only difference is the filter —
 * and the copy frames a free product as a legitimate starting point rather than a
 * giveaway. It is also placed *after* both paid bands, so nobody reads the
 * marketplace as free-first.
 *
 * ## Free means a real zero, in this currency
 *
 * The rows come from `free: true`, which is a bound on `activePrice.amount` in the
 * viewer's own currency. That distinction is load-bearing: a product with **no**
 * price row in this currency is "not sold here", not free, and the pipeline is
 * careful that `{ $lte: 0 }` cannot match a null. So this band is currency-correct
 * by construction, and the links carry the currency for the same reason —
 * `currencyMustBeInUrl` requires it once `free` is on, or the destination grid
 * would drop the filter.
 *
 * ## No consultation card
 *
 * The brief suggests a "Free Consultation" tile. Whether discovery is free is a
 * commercial rule this codebase does not encode, and the same brief forbids
 * unsupported claims — so the promise is absent rather than guessed at. What is
 * offered instead is true of the flow as built: the conversation costs nothing to
 * start, and needs no account until there is something to send.
 */
export async function FreeSection() {
  const currency = await resolveStorefrontCurrency();

  const [scripts, templates] = await Promise.all([
    searchMarketplaceRows({
      free: true,
      sort: "latest",
      page: 1,
      limit: 4,
      currency,
      catalogue: "script",
    }),
    searchMarketplaceRows({
      free: true,
      sort: "latest",
      page: 1,
      limit: 4,
      currency,
      catalogue: "template",
    }),
  ]);

  // Nothing free in this currency: the whole band would be a promise with no
  // product behind it.
  if (scripts.length === 0 && templates.length === 0) return null;

  // Templates first when there are any — the free half of the catalogue is
  // mostly front-ends, and they are the more persuasive thing to show.
  const cards = [...templates, ...scripts].slice(0, 4);

  return (
    <Band id="free" tone="muted">
      <SectionHead
        eyebrow="Free on CoSetup"
        title="Start with something free."
        lede="Genuinely free applications, scripts and website templates — the full thing, not a trial. Put one live as it stands, then customise or extend it when you need to."
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <ProductCardTile key={card.id} card={card} />
        ))}
      </div>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {templates.length > 0 && (
          <Door
            href={`/templates?free=true&currency=${currency}` as Route}
            title="Free website templates"
            body="Front-ends at no cost. Many pair with a full application if you later want the backend behind them."
          />
        )}
        {scripts.length > 0 && (
          <Door
            href={`/marketplace?free=true&currency=${currency}` as Route}
            title="Free applications & scripts"
            body="Working software you can install today. Paid plugins and integrations extend it when you're ready."
          />
        )}
      </div>
    </Band>
  );
}

function Door({ href, title, body }: { href: Route; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group border-border bg-surface hover:border-border-strong flex flex-col rounded-[22px] border p-5 transition"
    >
      <FreeBadge size="compact" className="self-start" />
      <span className="mt-3 flex items-center gap-2 text-[16.5px] font-medium tracking-[-0.02em]">
        {title}
        <ArrowRight
          className="text-subtle size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden
        />
      </span>
      <span className="text-muted-foreground mt-1.5 text-[13.5px] leading-relaxed">{body}</span>
    </Link>
  );
}

export function FreeSkeleton() {
  return (
    <Band tone="muted">
      <div className="bg-surface-muted h-[38px] w-[240px] animate-pulse rounded-full" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="bg-surface-muted h-[300px] animate-pulse rounded-xl" />
        ))}
      </div>
    </Band>
  );
}
