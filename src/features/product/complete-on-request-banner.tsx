import "server-only";
import Link from "next/link";
import type { Route } from "next";
import { Hammer } from "lucide-react";
import type { ProductDetail } from "@/services/marketplace/detail";

/**
 * On a template, the maker's offer to build the working application — COS-43.
 *
 * ## The sibling of `complete-application-banner.tsx`
 *
 * That one appears when the complete application already exists as a second
 * listing; this one appears when it does not, and somebody has said they will
 * build it. Same place on the page, same shape, one step earlier in the same
 * story — and the two are mutually exclusive by construction, because creating
 * the sibling withdraws the offer.
 *
 * ## Not suspended, unlike its sibling
 *
 * It reads nothing per-request: no currency, no session, no cookie. Everything it
 * draws is already on `ProductDetail`, which the page has in hand. Wrapping it in
 * `<Suspense>` would add a boundary with nothing to wait for.
 *
 * ## The name was checked against a test, and is fine
 *
 * `product-page.test.ts` finds the Suspense-wrapped components with
 * `code.indexOf("<CompleteApplicationBanner")` and friends — the **whole** tag, not
 * a short prefix, so `<CompleteOnRequestBanner` cannot be found in its place. Worth
 * recording because the sibling's own docblock warns about exactly this trap for a
 * name like `RelatedProductsBanner`, and the two names are close enough that the
 * next person will wonder.
 */
export function CompleteOnRequestBanner({ product }: { product: ProductDetail }) {
  const offer = product.completeOnRequest;

  // Absent unless the offer is live — `detail.ts` only maps the approved case.
  if (!offer) return null;

  const vendorName = product.vendor?.name;

  return (
    <section className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-5">
      <div className="flex flex-col gap-1">
        <span className="text-subtle flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.16em] uppercase">
          <Hammer className="size-3" aria-hidden />
          Complete on request
        </span>
        <p className="text-[14.5px] leading-relaxed">
          This template is available now.{" "}
          <span className="font-medium">Need the complete working application?</span>{" "}
          {/*
            The vendor's name when we have it, and "The maker" when we do not — a
            first-party template has no vendor, and `createTip`'s equivalent refusal
            is the precedent for not inventing one.

            The lead time is the vendor's own string and the clause disappears
            without it. We never state a duration nobody committed to.
          */}
          {vendorName ?? "The maker"} can build the remaining functionality for you
          {offer.leadTime ? `, usually within ${offer.leadTime}` : ""}.
        </p>
      </div>

      <div>
        <Link
          href={`/customize/${product.slug}` as Route}
          className="bg-foreground text-background inline-flex items-center rounded-full px-4 py-2 text-[13.5px] font-medium transition hover:opacity-90"
        >
          Request complete version
        </Link>
      </div>

      {offer.scope && (
        <div className="border-border flex flex-col gap-1 border-t pt-3">
          <p className="text-[13px] font-medium">What will be added?</p>
          {/* The vendor's own words. `whitespace-pre-wrap` keeps their line breaks
              without interpreting anything else — the same trust a transfer
              instruction gets. */}
          <p className="text-muted-foreground text-[13px] leading-relaxed whitespace-pre-wrap">
            {offer.scope}
          </p>
        </div>
      )}
    </section>
  );
}
