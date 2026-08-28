import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { ExternalLink, EyeOff, EyeClosed } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DEFAULT_CURRENCY } from "@/config/storefront";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorProfile } from "@/services/marketplace/storefront";
import { searchMarketplace } from "@/services/marketplace";
import { MAX_LIMIT } from "@/services/marketplace/pipeline";
import { StorefrontBody } from "@/features/storefront/components/storefront-body";
import { STOREFRONT_FIELD_LABELS } from "@/config/storefront";
import {
  hiddenStorefrontFields,
  platformStorefrontDefaults,
  resolveStorefrontVisibility,
} from "@/services/vendors/storefront-visibility";

// TODO: Cache Components — the three app shells opt out for the same reason; a per-request
// vendor guard cannot run inside a cached shell.
export const instant = false;

export const metadata: Metadata = { title: "Your storefront" };

/**
 * The vendor's own storefront, as they will appear — vendor ticket 11.
 *
 * ## Why this route exists at all
 *
 * `/vendors/[slug]` is **404** until a vendor is verified *and* has something published, and that
 * stays true: an empty storefront is a thin page, and a site full of them costs every other page
 * a little ranking. But the "View your storefront" button on the overview pointed straight at it,
 * so a vendor with one draft followed their own link and hit a not-found page. That reads as their
 * storefront being broken rather than as it not being live yet — the exact confusion this page
 * removes, without moving the public route's line by a millimetre.
 *
 * Same `StorefrontBody` as the public page, so the preview cannot drift from the thing it
 * previews. Two differences, both deliberate:
 *
 * - **A notice above it** naming what customers can and cannot see right now, and what makes it
 *   go live. A preview that looks identical to the real thing teaches the wrong lesson.
 * - **No JSON-LD and no breadcrumb.** The `Organization` node belongs on the indexable page;
 *   emitting it here — behind the authenticated-area `robots.ts` disallow — would be at best
 *   noise, and the `BreadcrumbList` would disagree with the visible navigation.
 *
 * ## `loadVendorProfile`, not `getVendorProfile`
 *
 * The cached reader is scoped to the public rule and returns `null` for a vendor who is not
 * verified. This page must render for a vendor in *any* state, including the one who has most
 * reason to look — so it reads the uncached loader directly. It also means a profile edit shows
 * here immediately, which is what a preview is for; the public page's cache tag is untouched.
 *
 * `requireVendorOrForbid` runs in this component's own body before any JSX, so the refusal is
 * decided before the first flush. The whole page is one vendor-scoped read, so there is nothing
 * worth streaming ahead of it and no `<Suspense>` pretending otherwise.
 */
export default async function Page() {
  const { vendor } = await requireVendorOrForbid();

  const [profile, listing, storefrontDefaults] = await Promise.all([
    loadVendorProfile(vendor.slug),
    searchMarketplace({
      vendor: [vendor.slug],
      currency: DEFAULT_CURRENCY,
      sort: "latest",
      page: 1,
      limit: MAX_LIMIT,
      // `"all"`, matching the public storefront this previews — a vendor must see
      // exactly what a visitor sees, or the preview is not one.
      catalogue: "all",
    }),
    /*
     * Resolved here, not read out of `loadVendorProfile`.
     *
     * That loader *omits* a hidden field rather than flagging it, which is what
     * keeps the public page free of any hint that a moderation decision was
     * taken. The consequence is that a vendor would otherwise watch their own
     * website link vanish from their preview with no explanation and file a bug.
     * `requireVendorOrForbid` already returned the whole record, so naming what
     * was hidden costs one more read and only on this page.
     */
    platformStorefrontDefaults(),
  ]);

  /*
   * `loadVendorProfile` reads the same collection `requireVendorOrForbid` just returned, so a
   * null here means the vendor was deleted between two awaits of one request. Nothing useful to
   * say about that, and it is not an error page's job — the notice below covers "not live yet",
   * which is the case a vendor will actually meet.
   */
  const live = profile !== null && listing.total > 0;
  const hidden = hiddenStorefrontFields(
    resolveStorefrontVisibility(vendor, storefrontDefaults),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Your storefront"
        description="What a customer sees when they follow your name from one of your products."
        breadcrumbs={[
          { label: "Selling", href: "/dashboard/selling" },
          { label: "Storefront" },
        ]}
        actions={
          live ? (
            <Button asChild variant="outline">
              <Link href={`/vendors/${vendor.slug}` as Route}>
                <ExternalLink className="size-3.5" aria-hidden />
                Open the live page
              </Link>
            </Button>
          ) : undefined
        }
      />

      {profile === null ? (
        <p className="border-border text-muted-foreground rounded-xl border border-dashed p-5 text-[13.5px]">
          We could not load your profile just now. Reload the page.
        </p>
      ) : (
        <div className="border-border rounded-xl border p-5 lg:p-7">
          <StorefrontBody
            vendor={profile}
            products={listing.products}
            productCount={listing.total}
            notice={
              <>
                {/*
                  Two notices, and they are about different things: one is "not live
                  yet, and here is what makes it live", which the vendor can act on;
                  the other is "we have hidden this", which they cannot. Merging them
                  into one paragraph would read as though verifying their identity
                  would bring the website link back.
                */}
                {hidden.length > 0 && (
                  <p className="border-border bg-surface-muted text-muted-foreground mb-7 flex items-start gap-2.5 rounded-xl border p-4 text-[13px]">
                    <EyeClosed className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      CoSetup is not showing the{" "}
                      {formatList(hidden.map((field) => STOREFRONT_FIELD_LABELS[field]))} on
                      your public storefront. Nothing has been deleted — you can still edit{" "}
                      {hidden.length === 1 ? "it" : "them"} in{" "}
                      <Link
                        href="/dashboard/selling/settings"
                        className="underline underline-offset-4"
                      >
                        your settings
                      </Link>
                      , and the preview below shows your storefront as customers see it. Write
                      to us if you think this is a mistake.
                    </span>
                  </p>
                )}

                {live ? null : (
                  <p className="mb-7 flex items-start gap-2.5 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-4 text-[13px]">
                    <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      {/* The two halves of the public rule, named separately, because a vendor
                        who is verified and unpublished must not go looking at verification. */}
                      This is a preview — customers cannot reach it yet.{" "}
                      {vendor.status !== "verified" ? (
                        <>
                          Your storefront goes live once your{" "}
                          <Link
                            href="/dashboard/selling/verification"
                            className="underline underline-offset-4"
                          >
                            identity is verified
                          </Link>{" "}
                          and you have a product on sale.
                        </>
                      ) : (
                        <>
                          It goes live as soon as one of your{" "}
                          <Link
                            href="/dashboard/selling/products"
                            className="underline underline-offset-4"
                          >
                            products
                          </Link>{" "}
                          is published — drafts and products in review are not shown to
                          customers.
                        </>
                      )}
                    </span>
                  </p>
                )}
              </>
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * "the cover image, the logo and the website link".
 *
 * Hand-rolled rather than `Intl.ListFormat`, which is the same call
 * `lib/countries.ts` made about `Intl.DisplayNames`: an `Intl` formatter can
 * disagree between the server's ICU build and the browser's, and a hydration
 * mismatch over an Oxford comma is a poor trade for a three-item list in one
 * locale.
 */
function formatList(items: readonly string[]): string {
  const lower = items.map((item) => item.toLowerCase());
  if (lower.length <= 1) return lower[0] ?? "";
  return `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}
