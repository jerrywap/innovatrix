import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Check, Cpu, Package, Server } from "lucide-react";
import { serverEnv } from "@/config/env";
import { Skeleton } from "@/components/ui/skeleton";
import { RichTextRenderer } from "@/lib/rich-text/render";
import {
  getCurrentSlugFor,
  getPrerenderSlugs,
  getProductDetail,
  type ProductDetail,
} from "@/services/marketplace/detail";
import { DemoPanel } from "@/features/product/demo-panel";
import { Gallery } from "@/features/product/gallery";
import { ProductJsonLd } from "@/features/product/json-ld";
import { BreadcrumbJsonLd, type Crumb } from "@/components/json-ld";
import { DEFAULT_CURRENCY } from "@/config/storefront";
import { PurchaseSection } from "@/features/product/purchase-section";
import { RelatedProducts } from "@/features/product/related";
import { ReviewsSection, reviewsForJsonLd } from "@/features/product/reviews-section";

/**
 * The product detail page — §8, §9, §93, §100.
 *
 * ## §100 is satisfied by structure, not by careful writing
 *
 * > A non-technical visitor can understand what the product does without
 * > meeting the words "framework", "ORM" or "deployment" above the technical
 * > section.
 *
 * A criterion like that, left to prose, degrades the first time somebody edits
 * a paragraph. So the page has an explicit `<TechnicalSection>` boundary and
 * everything above it — hero, gallery, overview, features, what-you-get — is
 * business language by construction. A test asserts those three words appear
 * nowhere before it, which turns a review opinion into something mechanical.
 *
 * "What you get" — licence, support window, update window — sits **above** the
 * technical block for the same reason: it is what a business owner is deciding
 * on, and burying it under a stack list answers the wrong person's question.
 *
 * ## A moved product redirects rather than 404s
 *
 * `slugHistory` exists so a shared link survives a rename. Checking it before
 * `notFound()` is what makes that real, and `permanentRedirect` (308) is the
 * one search engines transfer ranking through.
 */

export async function generateStaticParams() {
  const slugs = await getPrerenderSlugs(100);
  // Cache Components requires at least one param — an empty catalogue at build
  // time would otherwise fail the build rather than skip prerendering.
  return slugs.length > 0 ? slugs.map((slug) => ({ slug })) : [{ slug: "atlas-crm" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/marketplace/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductDetail(slug);
  if (!product) return { title: "Not found" };

  const title = product.seo.title ?? product.name;
  const description = product.seo.description ?? product.summary;
  const image = product.seo.ogImageUrl ?? product.media[0]?.url;

  return {
    title,
    description,
    alternates: { canonical: `/marketplace/${slug}` },
    openGraph: {
      title,
      description,
      type: "website",
      url: `/marketplace/${slug}`,
      ...(image ? { images: [{ url: image, alt: product.name }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
    },
  };
}

export default async function Page({ params }: PageProps<"/marketplace/[slug]">) {
  const { slug } = await params;
  const product = await getProductDetail(slug);

  if (!product) {
    const currentSlug = await getCurrentSlugFor(slug);
    // 308, not 302 — a renamed product's ranking should follow it.
    if (currentSlug) permanentRedirect(`/marketplace/${currentSlug}`);
    notFound();
  }

  const origin = serverEnv().APP_URL.replace(/\/$/, "");
  const hero = product.media[0];

  return (
    <article className="mx-auto w-full max-w-[1180px] px-5 py-10 lg:px-10 lg:py-14">
      {/* Recently-viewed is recorded in `proxy.ts`, not here: Next.js does not
          let a Server Component set a cookie, and attempting it throws. */}
      {/*
        `DEFAULT_CURRENCY`, not a hard-coded "GBP".
        
        The literal was here and the component has always taken the prop — so
        the storefront's configured default and the price advertised to a
        crawler could silently disagree the moment either changed. One source.
      */}
      {/*
        Vendor ticket 10. The rating rides in the cached `ProductDetail`; the individual
        reviews are loaded in a boundary, because a script tag can arrive after the shell and
        the alternative is blocking the LCP element on a review query.
      */}
      <Suspense fallback={null}>
        <RatedJsonLd product={product} origin={origin} />
      </Suspense>
      <BreadcrumbJsonLd crumbs={crumbsFor(product)} origin={origin} />

      <Breadcrumbs product={product} />

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-12">
          {/* ── hero ─────────────────────────────────────────── */}
          <header className="flex flex-col gap-4">
            <h1 className="font-display text-[32px] leading-[1.1] tracking-[-0.03em] lg:text-[40px]">
              {product.name}
            </h1>
            {/*
              Attribution — vendor ticket 11, and the answer to "who made this".
              
              Above the summary and linked, because a buyer weighing a third-party product asks
              who is behind it *before* reading what it does. Nothing at all for a first-party
              product: "by CoSetup" on a platform called CoSetup is noise.
            */}
            {product.vendor && (
              <p className="text-[13.5px]">
                <span className="text-subtle">by </span>
                <Link
                  href={`/vendors/${product.vendor.slug}` as Route}
                  className="underline underline-offset-4"
                >
                  {product.vendor.name}
                </Link>
              </p>
            )}

            <p className="text-muted-foreground max-w-[62ch] text-[16px] leading-relaxed">
              {product.summary}
            </p>
            <Badges product={product} />
          </header>

          {hero && (
            <div className="flex flex-col gap-2">
              <div className="border-border bg-surface-muted relative aspect-[16/9] overflow-hidden rounded-xl border">
                {/* A plain RSC `next/image` with `priority` — the LCP element
                    must not wait for the gallery island to hydrate. */}
                <Image
                  src={hero.url}
                  alt={hero.alt}
                  fill
                  sizes="(min-width: 1024px) 780px, 100vw"
                  priority
                  className="object-cover"
                />
              </div>
              <Gallery images={product.media} productName={product.name} />
            </div>
          )}

          {product.description && (
            <section className="flex flex-col gap-4">
              <h2 className="font-display text-[19px] tracking-[-0.02em]">What it does</h2>
              <div className="max-w-[68ch] text-[14.5px] leading-relaxed">
                <RichTextRenderer doc={product.description} />
              </div>
            </section>
          )}

          {product.features.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="font-display text-[19px] tracking-[-0.02em]">
                What&rsquo;s included
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {product.features.map((feature) => (
                  <li key={feature.title} className="flex gap-2.5">
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-[var(--signal)]"
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium">{feature.title}</span>
                      {feature.detail && (
                        <span className="text-muted-foreground block text-[12.5px]">
                          {feature.detail}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <WhatYouGet product={product} />
          <Installation product={product} />

          <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
            <DemoPanel product={product} />
          </Suspense>

          {product.versions.length > 0 && <Versions product={product} />}

          {/* ══ everything below here may speak to a developer ══ */}
          <TechnicalSection product={product} />

          <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
            <ReviewsSection product={product} />
          </Suspense>

          <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
            <RelatedProducts product={product} />
          </Suspense>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
            <PurchaseSection product={product} />
          </Suspense>
        </aside>
      </div>
    </article>
  );
}

/**
 * The structured data, with its reviews.
 *
 * Its own component so the review query sits inside a `<Suspense>` boundary rather than in the
 * page body — the JSON-LD is for crawlers and the hero image is for people, and only one of
 * them should be waiting on the other.
 */
async function RatedJsonLd({ product, origin }: { product: ProductDetail; origin: string }) {
  const reviews = product.rating ? await reviewsForJsonLd(product.id) : [];

  return (
    <ProductJsonLd
      product={product}
      currency={DEFAULT_CURRENCY}
      origin={origin}
      reviews={reviews}
    />
  );
}

/* ────────────────────────────────────────────── sections */

/**
 * The crumbs, once, for both the visible nav and the structured data.
 *
 * Derived rather than written twice: a `BreadcrumbList` that disagrees with the
 * rendered breadcrumb is a structured-data policy violation, and two hand-kept
 * lists disagree the first time somebody edits one.
 */
function crumbsFor(product: ProductDetail): Crumb[] {
  const category = product.taxonomy.categories[0];

  return [
    { name: "Marketplace", path: "/marketplace" },
    ...(category
      ? [{ name: category.name, path: `/marketplace/category/${category.slug}` }]
      : []),
    // No `path` on the last one — schema.org's way of saying "you are here".
    { name: product.name },
  ];
}

function Breadcrumbs({ product }: { product: ProductDetail }) {
  const category = product.taxonomy.categories[0];

  return (
    <nav aria-label="Breadcrumb" className="text-subtle flex flex-wrap gap-1.5 text-[12.5px]">
      <Link href="/marketplace" className="hover:text-foreground">
        Marketplace
      </Link>
      {category && (
        <>
          <span aria-hidden>/</span>
          <Link
            href={`/marketplace/category/${category.slug}` as Route}
            className="hover:text-foreground"
          >
            {category.name}
          </Link>
        </>
      )}
      <span aria-hidden>/</span>
      <span className="text-foreground">{product.name}</span>
    </nav>
  );
}

function Badges({ product }: { product: ProductDetail }) {
  const current = product.versions.find((version) => version.isCurrent);

  return (
    <ul className="flex flex-wrap gap-2">
      {current && (
        <Badge>
          <Package className="size-3" aria-hidden />v{current.version}
        </Badge>
      )}
      {product.taxonomy.categories.map((term) => (
        <Badge key={term.slug}>{term.name}</Badge>
      ))}
      {product.taxonomy.industries.map((term) => (
        <Badge key={term.slug}>For {term.name.toLowerCase()}</Badge>
      ))}
      {product.customization.available && <Badge>Can be adapted</Badge>}
    </ul>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <li className="border-border flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]">
      {children}
    </li>
  );
}

/**
 * Licence, support and updates in plain language — §8, and above the technical
 * block on purpose. This is what a business owner is deciding on.
 */
function WhatYouGet({ product }: { product: ProductDetail }) {
  const pkg = product.licencePackages[0];
  if (!pkg) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[19px] tracking-[-0.02em]">What you get</h2>
      <dl className="border-border bg-surface grid gap-x-6 gap-y-3 rounded-xl border p-4 sm:grid-cols-2">
        <Row
          term="Where you can install it"
          detail={
            pkg.activationLimit === 1
              ? "One installation, on a site you control."
              : pkg.activationLimit >= 999
                ? "As many installations as you need."
                : `Up to ${pkg.activationLimit} installations.`
          }
        />
        <Row
          term="Updates"
          detail={`${pkg.updateMonths} months of new versions, included. You keep every version released in that window, permanently.`}
        />
        <Row
          term="Support"
          detail={`${pkg.supportMonths} months of help from us if something doesn't work.`}
        />
        <Row term="Source code" detail="Included. It is yours to modify." />
      </dl>
    </section>
  );
}

function Installation({ product }: { product: ProductDetail }) {
  const { selfInstall, innovatrixInstall, managedHosting } = product.installation;
  if (!selfInstall && !innovatrixInstall && !managedHosting) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[19px] tracking-[-0.02em]">Getting it running</h2>
      <ul className="flex flex-col gap-2">
        {selfInstall && (
          <Option
            icon={<Package className="size-4" aria-hidden />}
            title="Install it yourself"
            detail="Download the package and follow the setup guide."
          />
        )}
        {innovatrixInstall && (
          <Option
            icon={<Server className="size-4" aria-hidden />}
            title="We install it for you"
            detail="Add it on when you buy, and we set it up on your server."
          />
        )}
        {managedHosting && (
          <Option
            icon={<Cpu className="size-4" aria-hidden />}
            title="We host and run it"
            detail="No server of your own. We handle updates and backups."
          />
        )}
      </ul>
    </section>
  );
}

function Option({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <li className="border-border bg-surface flex gap-3 rounded-xl border p-3.5">
      <span className="text-subtle mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="text-muted-foreground block text-[12.5px]">{detail}</span>
      </span>
    </li>
  );
}

function Versions({ product }: { product: ProductDetail }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[19px] tracking-[-0.02em]">Versions</h2>
      <ul className="border-border divide-border divide-y overflow-hidden rounded-xl border">
        {product.versions.slice(0, 10).map((version) => (
          <li key={version.id} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="font-mono text-[13px] font-medium">v{version.version}</span>
              {version.isCurrent && (
                <span className="rounded-full bg-[var(--signal)]/12 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-[var(--signal)] uppercase">
                  Current
                </span>
              )}
              {/* Absolute, never "3 days ago" — relative time differs between
                  server and client and flickers at hydration. */}
              {version.releasedAt && (
                <span className="text-subtle font-mono text-[11px]">{version.releasedAt}</span>
              )}
            </div>
            {version.changelog && (
              <p className="text-muted-foreground text-[12.5px]">{version.changelog}</p>
            )}
            {version.updateNote && (
              <p className="text-subtle text-[12px]">{version.updateNote}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The §100 boundary.
 *
 * Everything from here down may use the vocabulary a developer wants and a
 * business owner does not. Exported so a test can assert that "framework",
 * "ORM" and "deployment" appear nowhere above it.
 */
export function TechnicalSection({ product }: { product: ProductDetail }) {
  const { technologies } = product.taxonomy;
  if (technologies.length === 0 && !product.requirements) return null;

  return (
    <section id="technical" className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-[19px] tracking-[-0.02em]">Technical detail</h2>
        <p className="text-muted-foreground text-[13px]">
          For whoever will install it. Nothing here changes what the product does.
        </p>
      </div>

      {technologies.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {technologies.map((term) => (
            <span
              key={term.slug}
              className="border-border rounded-full border px-2.5 py-1 font-mono text-[11.5px]"
            >
              {term.name}
            </span>
          ))}
        </div>
      )}

      {product.requirements && (
        <div className="border-border bg-surface rounded-xl border p-4">
          <p className="text-subtle mb-1.5 font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Requirements
          </p>
          <p className="text-[13px] whitespace-pre-line">{product.requirements}</p>
        </div>
      )}
    </section>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">{term}</dt>
      <dd className="mt-0.5 text-[13px]">{detail}</dd>
    </div>
  );
}
