import "server-only";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Boxes } from "lucide-react";
import { FreeBadge } from "@/components/free-badge";
import { MoneyDisplay } from "@/components/money-display";
import { CATALOGUE_SURFACE } from "@/config/catalogue";
import { money } from "@/lib/money";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { getLinkedScriptListing, type ProductDetail } from "@/services/marketplace/detail";

/**
 * On a website template, the offer of the complete application behind it.
 *
 * One app is often two listings: the front-end on its own, and the working
 * software. Somebody on the template's page may not know the second exists, and the
 * template page is the only place that can tell them — the grid deliberately keeps
 * the two catalogues apart.
 *
 * ## Why this is a component and not a line in the page
 *
 * It needs the viewer's currency, and the currency lives in a cookie. Nothing in
 * the product page's body reads cookies; only its suspended children do
 * (`purchase-section.tsx`, `related.tsx`), because an unsuspended cookie read makes
 * the **whole route** dynamic and the static shell stops prerendering. So this is
 * modelled on `related.tsx` line for line, and the page wraps it in `<Suspense>`.
 *
 * ## The name is chosen against a test
 *
 * `product-page.test.ts` checks Suspense proximity with `code.indexOf("<DemoPanel")`
 * and friends — a **prefix** match. A component called `RelatedProductsBanner`
 * would be found before the real `RelatedProducts` and the assertion would measure
 * the wrong thing. `CompleteApplicationBanner` collides with none of the three in
 * either direction.
 *
 * Renders nothing when there is no link, no published sibling, or no price at all —
 * the same discipline as `RelatedProducts`, and for the same reason: a heading over
 * a blank space reads as a broken page.
 */
export async function CompleteApplicationBanner({ product }: { product: ProductDetail }) {
  if (!product.scriptListingId) return null;

  const currency = await resolveStorefrontCurrency();

  const script = await getLinkedScriptListing(product.scriptListingId, product.slug);
  if (!script) return null;

  const price = script.prices.find((row) => row.currency === currency);

  return (
    <Link
      /*
       * Through `CATALOGUE_SURFACE`, never a `/marketplace/` literal — that table is
       * the seam for the template catalogue's eventual move to its own domain, and
       * this is one of the links that has to follow it.
       */
      href={`${CATALOGUE_SURFACE.script.productPath}/${script.slug}` as Route}
      className="border-border bg-surface flex items-center gap-3.5 rounded-xl border p-3.5 transition-colors hover:border-[var(--signal)]/40 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
    >
      <span className="bg-surface-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Boxes className="text-muted-foreground size-4" aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        {/*
          The scope disclosure first. A visitor who has just looked at the
          screenshots has formed an impression that this line corrects, and it is
          more useful to them than the offer that follows it.
        */}
        <span className="text-subtle block font-mono text-[10.5px] tracking-[0.14em] uppercase">
          This is the front-end only
        </span>
        <span className="font-display mt-0.5 block text-[15.5px] tracking-[-0.01em]">
          {script.name} — the complete application
        </span>
        <span className="text-muted-foreground block text-[13px]">
          Working backend included, ready to run.
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2.5">
        {/*
          Three states, three renders — the `product-card.tsx` grammar.

          `money()` throws on an absent or non-integer amount, so it is never called
          on the third branch. And the third branch says "Price on request" rather
          than falling back to another currency or to zero: reporting "not priced in
          NGN" as free is the bug `pipeline.ts` calls the worst possible one.
        */}
        {price ? (
          price.amount === 0 ? (
            <FreeBadge />
          ) : (
            <MoneyDisplay
              value={money(price.amount, currency)}
              className="text-[15px] font-medium"
            />
          )
        ) : (
          <span className="text-muted-foreground text-[13px]">Price on request</span>
        )}
        <ArrowRight className="text-subtle size-4" aria-hidden />
      </span>
    </Link>
  );
}
