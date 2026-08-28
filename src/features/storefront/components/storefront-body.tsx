import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { BadgeCheck, ExternalLink, Package } from "lucide-react";
import { StarRating } from "@/components/star-rating";
import { CATALOGUE_SURFACE } from "@/config/catalogue";
import { countryName, flagOf } from "@/lib/countries";
import { formatDay } from "@/lib/dates";
import { initialsOf } from "@/lib/initials";
import type { ProductCard } from "@/services/marketplace";
import type { VendorProfile } from "@/services/marketplace/storefront";
import { ProductCardTile } from "@/features/marketplace/components/product-card";

/**
 * What a storefront looks like — vendor ticket 11, rebuilt.
 *
 * ## Why it lives out of the page
 *
 * `/vendors/[slug]` answers **404** for a verified vendor with nothing published, and that is
 * deliberate: an empty storefront in the index is a thin page, and a site full of them costs every
 * other page a little ranking. But it left the vendor with no way to see their own — the "View your
 * storefront" button on their dashboard led to that 404, which reads as their storefront being
 * broken rather than as not being live yet.
 *
 * So the presentation lives here and two routes use it: the public page, and a preview under
 * `/dashboard/selling` that a vendor can always open. One component, so the preview cannot drift
 * from the thing it is previewing — which is the only way a preview is worth having.
 *
 * The **structured data stays on the public page**. A preview must not emit an `Organization` node
 * or a `BreadcrumbList`: it lives behind the authenticated-area disallow, and JSON-LD on a page
 * crawlers cannot reach is at best noise.
 *
 * ## The cover is a band, not a bleed
 *
 * A full-bleed cover was the obvious design and is the one thing this component
 * cannot have. The public route's wrapper is `max-w-[1180px]` and the preview's
 * is a bordered card at `p-5 lg:p-7`, so bleeding would need a negative-margin
 * escape on one surface and not the other — the first drift between preview and
 * reality, introduced into the component built to prevent it. A rounded band
 * inside the column is identical on both and matches the app's `--radius` card
 * language anyway.
 *
 * ## Fields may be absent because staff removed them
 *
 * `loadVendorProfile` omits what `resolveStorefrontVisibility` says to hide, so
 * everything optional here is optional for two different reasons — the vendor
 * never filled it in, or staff switched it off — and this component cannot tell
 * them apart. That is intended: the public page must not hint at a moderation
 * decision. The vendor is told, through `notice`, by the preview route which
 * *can* tell.
 */
export function StorefrontBody({
  vendor,
  products,
  productCount,
  /** Rendered above the header, for the preview. */
  notice,
}: {
  vendor: VendorProfile;
  products: readonly ProductCard[];
  productCount: number;
  notice?: React.ReactNode;
}) {
  const groups = groupByCatalogue(products);

  return (
    <>
      {notice}

      <header className="flex flex-col">
        <Cover vendor={vendor} />

        {/*
          The logo overlaps the band; **the name does not**.

          The first version lifted the whole identity block with one negative
          margin, which put the `<h1>` across the cover's bottom edge — legible
          over the gradient fallback and unreadable over a real photograph, which
          is the case that matters. Only the tile is lifted now, and everything
          else sits below in normal flow, so there is no width at which the name
          can collide with the artwork.
        */}
        <div className="-mt-10 px-1 sm:-mt-12 sm:px-2">
          <Logo vendor={vendor} />
        </div>

        <div className="mt-4 flex flex-col gap-4 px-1 sm:px-2">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="font-display text-[28px] leading-[1.1] tracking-[-0.03em] sm:text-[32px]">
              {vendor.displayName}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
              {/* Worded as identity verification and nothing more. "Verified vendor" would
                  imply we have checked their software, which we have not. */}
              {vendor.identityVerified && (
                <span className="flex items-center gap-1.5 text-[var(--signal)]">
                  <BadgeCheck className="size-4" aria-hidden />
                  Identity verified by CoSetup
                </span>
              )}

              {vendor.websiteUrl && (
                <a
                  href={vendor.websiteUrl}
                  // `nofollow noopener` on a vendor-supplied URL: the public page is indexable,
                  // and passing ranking to a link a vendor typed is how a storefront becomes an
                  // SEO product. `noreferrer` keeps our URLs out of their logs.
                  rel="nofollow noopener noreferrer"
                  target="_blank"
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 underline underline-offset-4"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  {hostOf(vendor.websiteUrl)}
                </a>
              )}
            </div>
          </div>

          {vendor.summary && (
            <p className="text-muted-foreground max-w-[68ch] text-[15px] leading-relaxed">
              {vendor.summary}
            </p>
          )}

          <Stats vendor={vendor} productCount={productCount} />
        </div>
      </header>

      <section className="mt-10 flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-[19px] tracking-[-0.02em]">
            What {vendor.displayName} sells
          </h2>
          {products.length > 0 && (
            <Link
              href={`/marketplace?vendor=${vendor.slug}` as Route}
              className="text-muted-foreground hover:text-foreground text-[12.5px] underline underline-offset-4"
            >
              See these alongside everything else
            </Link>
          )}
        </div>

        {products.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-xl border border-dashed p-5 text-[13.5px]">
            Nothing published yet. A product appears here as soon as it goes on sale — drafts
            and products still in review are not shown to customers.
          </p>
        ) : (
          groups.map((group, index) => (
            <div key={group.catalogue} className="flex flex-col gap-4">
              {/*
                A heading only where there is something to distinguish. A vendor who sells one
                script would otherwise get "Software & Scripts (1)" over their only product,
                which is a label rather than navigation — and `groupByCatalogue` never returns an
                empty group, so there is no "Website Templates (0)" underneath it either.
              */}
              {groups.length > 1 && (
                <h3 className="text-subtle text-[11px] font-medium tracking-[0.08em] uppercase">
                  {CATALOGUE_SURFACE[group.catalogue].plural}{" "}
                  <span className="text-muted-foreground">({group.cards.length})</span>
                </h3>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.cards.map((card, cardIndex) => (
                  <ProductCardTile
                    key={card.id}
                    card={card}
                    // The first card of the first group is the LCP element once the cover has
                    // loaded, and this page passed `priority` to nothing at all before.
                    priority={index === 0 && cardIndex === 0}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}

/* ────────────────────────────────────────────── the header's pieces */

/**
 * The cover band, or something deliberate in its place.
 *
 * Most vendors have no cover — the field did not exist until now — so the
 * fallback is the common case rather than the degraded one, and it has to look
 * like a decision. A gradient picked from the vendor's own slug gives two
 * storefronts different bands without asking anybody to choose one, and it is a
 * pure function of a string, so the server and the client draw the same thing
 * and nothing flickers at hydration.
 */
function Cover({ vendor }: { vendor: VendorProfile }) {
  return (
    <div className="bg-surface-muted relative h-36 w-full overflow-hidden rounded-2xl sm:h-44 lg:h-56">
      {vendor.coverUrl ? (
        <Image
          src={vendor.coverUrl}
          // Empty: the cover is decoration behind a heading that already names the vendor.
          // Describing it would announce "Jerry Script cover image" before the name itself.
          alt=""
          fill
          sizes="(min-width: 1180px) 1180px, 100vw"
          // The one place `object-cover` is right on a vendor image. A logo is a wordmark and
          // must never be cropped (see below); a cover is scenery, and letterboxing scenery
          // inside a band is worse than trimming it.
          className="object-cover"
          priority
        />
      ) : (
        <div
          aria-hidden
          className={`size-full bg-gradient-to-br ${gradientFor(vendor.slug)}`}
        />
      )}
    </div>
  );
}

/**
 * `object-contain`, and that is not a preference.
 *
 * `vendor-byline.tsx` settled it: *"It is a company logo, not a face."* A circle
 * crops wordmarks and `object-cover` crops them further, so the box is square,
 * softly rounded, and shows the whole mark on its own ground.
 *
 * The border is `--background` rather than `--border` so the tile reads as
 * lifted off the band behind it rather than drawn on top of it.
 */
function Logo({ vendor }: { vendor: VendorProfile }) {
  return (
    <div className="border-background bg-surface relative size-20 overflow-hidden rounded-2xl border-4 shadow-sm lg:size-24">
      {vendor.logoUrl ? (
        <Image
          src={vendor.logoUrl}
          alt={`${vendor.displayName} logo`}
          fill
          sizes="96px"
          className="object-contain p-2"
        />
      ) : (
        // `aria-hidden`: the name is the `<h1>` immediately beside it, and a screen reader
        // reading "JS, Jerry Script" says one thing twice — `VendorByline`'s reasoning.
        <span
          aria-hidden
          className="text-muted-foreground absolute inset-0 flex items-center justify-center text-[22px] font-semibold"
        >
          {initialsOf(vendor.displayName)}
        </span>
      )}
    </div>
  );
}

/**
 * Four facts, and only the ones that are true.
 *
 * Each cell renders or does not; there is no placeholder and no zero. That
 * matters most for the rating: `StarRating` returns `null` for a null average
 * precisely so an unreviewed vendor is not framed as a nought-star one, and a
 * "0.0 ★" cell here would undo that carefully.
 *
 * The country is the free upgrade — it rendered as the raw ISO code, and
 * `countryName` and `flagOf` were already in `lib/countries.ts` and unused here.
 */
function Stats({ vendor, productCount }: { vendor: VendorProfile; productCount: number }) {
  const cells: React.ReactNode[] = [
    <Stat
      key="products"
      icon={<Package className="size-3.5" aria-hidden />}
      value={String(productCount)}
      label={productCount === 1 ? "product on sale" : "products on sale"}
    />,
  ];

  if (vendor.rating) {
    cells.push(
      <Stat
        key="rating"
        // The stars themselves rather than the number they encode: five glyphs are
        // recognisable at a glance across a grid of four cells in a way "4.6" is not, and
        // `StarRating` already carries the clipping and the count formatting.
        value={<StarRating average={vendor.rating.average} count={vendor.rating.count} />}
        label="customer rating"
      />,
    );
  }

  if (vendor.sellingSince) {
    cells.push(
      <Stat
        key="since"
        // Absolute, never "8 months ago": a relative date differs between the server and the
        // client and flickers at hydration. `formatDay` is the shared answer.
        value={formatDay(vendor.sellingSince)}
        label="selling here since"
      />,
    );
  }

  if (vendor.country) {
    cells.push(
      <Stat
        key="country"
        // The flag glyph is decoration beside the name, never instead of it:
        // `countries.ts` notes that some platforms render no flag at all, and a
        // cell reading only "🇬🇧" on those would be an empty cell.
        icon={<span aria-hidden>{flagOf(vendor.country)}</span>}
        value={countryName(vendor.country) ?? vendor.country}
        label="based in"
      />,
    );
  }

  return (
    /*
      `grid-flow-col` with `auto-cols-fr` above `sm`, rather than a column count.
      The number of cells is decided above — a vendor with no reviews and no
      location has two — and a fixed `sm:grid-cols-4` left the last one stretched
      across the empty half of the row. Flowing into equal auto columns fits
      whatever survives, and Tailwind cannot take a computed count anyway.
    */
    <dl className="border-border divide-border grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none sm:divide-y-0">
      {cells}
    </dl>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon?: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 p-3.5">
      <dt className="text-subtle order-2 text-[11.5px]">{label}</dt>
      <dd className="order-1 flex items-center gap-1.5 text-[15px] font-medium">
        {icon}
        {value}
      </dd>
    </div>
  );
}

/* ────────────────────────────────────────────── pure helpers */

/**
 * Partition the cards the page already has. No second query, and no `catalogue`
 * facet — the storefront asks for `"all"` because a vendor selling both a script
 * and a template has one shop, not two, and this only groups what came back.
 *
 * Ordered by `CATALOGUE_SURFACE`'s own key order rather than by first
 * appearance, so a vendor's two sections do not swap places when their newest
 * product changes catalogue.
 */
function groupByCatalogue(products: readonly ProductCard[]) {
  return (Object.keys(CATALOGUE_SURFACE) as Array<ProductCard["catalogue"]>)
    .map((catalogue) => ({
      catalogue,
      cards: products.filter((card) => card.catalogue === catalogue),
    }))
    .filter((group) => group.cards.length > 0);
}

/**
 * The host, or the whole URL.
 *
 * `new URL()` **throws** on anything it cannot parse, and this runs on a value a
 * vendor typed. The Zod schema makes that unlikely rather than impossible — a
 * row saved before the schema tightened, or a seed — and the failure mode was
 * the entire storefront 500ing over a link.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * A band for a vendor with no cover, stable for the life of their slug.
 *
 * From `--chart-*` and `--signal`, which are already defined in both themes, so
 * the fallback needs no dark-mode branch of its own. The slug is immutable once
 * a vendor is verified, so a storefront's band does not change under a returning
 * visitor.
 */
const COVER_GRADIENTS = [
  "from-[var(--chart-1)]/55 via-[var(--chart-2)]/30 to-[var(--chart-4)]/20",
  "from-[var(--chart-5)]/55 via-[var(--chart-4)]/30 to-[var(--chart-3)]/20",
  "from-[var(--chart-2)]/55 via-[var(--chart-3)]/30 to-[var(--chart-5)]/20",
  "from-[var(--chart-4)]/55 via-[var(--chart-1)]/25 to-[var(--chart-2)]/20",
  "from-[var(--signal)]/45 via-[var(--chart-3)]/30 to-[var(--chart-5)]/20",
] as const;

function gradientFor(slug: string): string {
  let sum = 0;
  for (let index = 0; index < slug.length; index += 1) sum += slug.charCodeAt(index);
  return COVER_GRADIENTS[sum % COVER_GRADIENTS.length] ?? COVER_GRADIENTS[0];
}
