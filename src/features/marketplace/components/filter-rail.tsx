import Link from "next/link";
import type { Route } from "next";
import {
  marketplaceHref,
  toggleTerm,
  type RawSearchParams,
} from "@/services/marketplace/query";
import type { FacetCount, MarketplaceSort } from "@/services/marketplace/pipeline";
import type { TaxonomyIndex } from "@/services/marketplace";
import type { StorefrontCurrency } from "@/config/storefront";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";

/**
 * The filter rail — §6.
 *
 * A **Server Component made of links**, not a client component with state.
 * Every control is an `<a>` whose href is the next URL, which gets three things
 * for free: it works before hydration, Back does what Back should do, and the
 * "copy the URL and someone else sees the same results" criterion is true by
 * construction rather than by a `useEffect` that syncs state into the URL.
 *
 * ## Every term always renders
 *
 * Terms come from the cached taxonomy, not from the result set, so the rail
 * never loses options as it narrows — the dead end where filtering to two
 * things leaves you unable to filter to a third.
 *
 * ## Counts appear on some dimensions and not others
 *
 * They are computed over the **already-filtered** set, which makes them correct
 * for a dimension with nothing selected and misleading for one that is already
 * filtering: within a dimension the terms are OR'd, so ticking a second
 * category *widens* the result set, and a count showing "3" next to a term that
 * would add 12 rows is worse than no count. `dimensionsWithHonestCounts` draws
 * that line; this renders it.
 */

const DIMENSIONS = [
  { key: "category", kind: "category", label: "Category" },
  { key: "industry", kind: "industry", label: "Industry" },
  { key: "technology", kind: "technology", label: "Technology" },
  { key: "productType", kind: "product_type", label: "Type" },
] as const;

const SORTS: Array<{ value: MarketplaceSort; label: string }> = [
  { value: "latest", label: "Newest" },
  { value: "popular", label: "Most bought" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

export function FilterRail({
  basePath,
  raw,
  taxonomy,
  facetCounts,
  countableDimensions,
  currency,
  currencyInUrl,
  /** Dimensions a landing page owns — rendered as context, not as a control. */
  locked = [],
}: {
  basePath: string;
  raw: RawSearchParams;
  taxonomy: TaxonomyIndex;
  facetCounts: readonly FacetCount[];
  countableDimensions: readonly FacetCount["dimension"][];
  currency: StorefrontCurrency;
  currencyInUrl: boolean;
  locked?: ReadonlyArray<(typeof DIMENSIONS)[number]["key"]>;
}) {
  const countOf = new Map(
    facetCounts.map((count) => [`${count.dimension}:${count.slug}`, count.count]),
  );

  return (
    <aside className="flex flex-col gap-6" aria-label="Filters">
      <Section title="Sort">
        <div className="flex flex-col gap-0.5">
          {SORTS.map((option) => (
            <RailLink
              key={option.value}
              href={marketplaceHref(basePath, raw, { sort: option.value })}
              active={(raw.sort ?? "latest") === option.value}
              label={option.label}
            />
          ))}
        </div>
      </Section>

      {DIMENSIONS.filter((dimension) => !locked.includes(dimension.key)).map((dimension) => {
        const terms = taxonomy[dimension.kind];
        if (terms.length === 0) return null;

        const showCounts = countableDimensions.includes(dimension.key);
        const selected = new Set(asArray(raw[dimension.key]));

        return (
          <Section key={dimension.key} title={dimension.label}>
            <div className="flex flex-col gap-0.5">
              {terms.map((term) => {
                const count = countOf.get(`${dimension.key}:${term.slug}`) ?? 0;
                const isSelected = selected.has(term.slug);

                // Single-valued: a product has one type, so "either type" is
                // not a question anyone is asking.
                const changes =
                  dimension.key === "productType"
                    ? { productType: isSelected ? undefined : term.slug }
                    : toggleTerm(raw, dimension.key, term.slug);

                return (
                  <RailLink
                    key={term.slug}
                    href={marketplaceHref(basePath, raw, changes)}
                    active={isSelected}
                    label={term.name}
                    count={showCounts ? count : undefined}
                    // A term with no matches is still clickable — it just
                    // widens the set, which is what OR means.
                    muted={showCounts && count === 0}
                  />
                );
              })}
            </div>
          </Section>
        );
      })}

      <Section title="Options">
        <RailLink
          href={marketplaceHref(basePath, raw, {
            customisable: raw.customisable === "true" ? undefined : true,
          })}
          active={raw.customisable === "true"}
          label="Can be adapted"
        />
      </Section>

      <Section title={`Price (${currency})`}>
        <PriceFilter basePath={basePath} raw={raw} currency={currency} />
      </Section>

      <Section title="Currency">
        <div className="flex gap-1.5">
          {STOREFRONT_CURRENCIES.map((code) => (
            <Link
              key={code}
              href={
                marketplaceHref(basePath, raw, {
                  // Once a price bound is active the currency **must** ride in
                  // the URL — "under 50,000" of what? — or the same link gives
                  // two people different result sets.
                  currency: currencyInUrl || code !== currency ? code : undefined,
                }) as Route
              }
              aria-current={code === currency ? "true" : undefined}
              className={`border-border rounded-lg border px-2.5 py-1 font-mono text-[11.5px] ${
                code === currency
                  ? "border-[var(--signal)] text-[var(--signal)]"
                  : "text-subtle"
              }`}
            >
              {code}
            </Link>
          ))}
        </div>
      </Section>

      {hasAnyFilter(raw) && (
        <Link
          href={basePath as Route}
          className="text-subtle text-[12.5px] underline underline-offset-4"
        >
          Clear all filters
        </Link>
      )}
    </aside>
  );
}

/**
 * Price bounds as a GET form.
 *
 * A form, not two links, because a range is typed rather than chosen — and a
 * plain GET form submits to the URL, which keeps the no-JavaScript guarantee
 * the rest of the rail has. The hidden fields carry the other filters, since a
 * form submission replaces the query string wholesale.
 */
function PriceFilter({
  basePath,
  raw,
  currency,
}: {
  basePath: string;
  raw: RawSearchParams;
  currency: StorefrontCurrency;
}) {
  const carried = Object.entries(raw).filter(
    ([key]) => !["minPrice", "maxPrice", "page", "currency"].includes(key),
  );

  return (
    <form action={basePath} method="get" className="flex flex-col gap-2">
      {carried.flatMap(([key, value]) =>
        asArray(value).map((item, index) => (
          <input key={`${key}-${index}`} type="hidden" name={key} value={item} />
        )),
      )}
      <input type="hidden" name="currency" value={currency} />

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          name="minPrice"
          defaultValue={first(raw.minPrice) ?? ""}
          min={0}
          step={100}
          placeholder="Min"
          aria-label={`Minimum price in ${currency}, in minor units`}
          className="border-border bg-background h-8 w-full rounded-lg border px-2 font-mono text-[12px]"
        />
        <span className="text-subtle text-[12px]">–</span>
        <input
          type="number"
          name="maxPrice"
          defaultValue={first(raw.maxPrice) ?? ""}
          min={0}
          step={100}
          placeholder="Max"
          aria-label={`Maximum price in ${currency}, in minor units`}
          className="border-border bg-background h-8 w-full rounded-lg border px-2 font-mono text-[12px]"
        />
      </div>

      <button
        type="submit"
        className="border-border hover:bg-surface-muted h-8 rounded-lg border text-[12.5px]"
      >
        Apply
      </button>
      <p className="text-subtle text-[11px]">
        In minor units — 29999 is {currency === "NGN" ? "₦299.99" : "299.99"}.
      </p>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        {title}
      </h2>
      {children}
    </div>
  );
}

function RailLink({
  href,
  active,
  label,
  count,
  muted,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
  muted?: boolean;
}) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? "true" : undefined}
      className={`hover:bg-surface-muted flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[13px] ${
        active ? "bg-surface-muted font-medium" : muted ? "text-subtle" : ""
      }`}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className="text-subtle shrink-0 font-mono text-[10.5px]">{count}</span>
      )}
    </Link>
  );
}

function hasAnyFilter(raw: RawSearchParams): boolean {
  return [
    "q",
    "category",
    "industry",
    "technology",
    "productType",
    "minPrice",
    "maxPrice",
    "customisable",
  ].some((key) => asArray(raw[key]).length > 0);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
