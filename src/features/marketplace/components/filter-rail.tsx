import Link from "next/link";
import type { Route } from "next";
import {
  activeFilterCount,
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
  vendorLabels,
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
  /** Slug → display name for any vendor filter in the URL — vendor ticket 11. */
  vendorLabels?: ReadonlyMap<string, string>;
  locked?: ReadonlyArray<(typeof DIMENSIONS)[number]["key"]>;
}) {
  const countOf = new Map(
    facetCounts.map((count) => [`${count.dimension}:${count.slug}`, count.count]),
  );

  /**
   * Every href in this rail, through one function.
   *
   * It exists to honour `currencyInUrl`, which is `currencyMustBeInUrl(query)` —
   * "there is a price bound, so the URL has to say 50,000 *of what*". That
   * invariant was declared, tested, and then enforced in exactly one place: the
   * currency chip. So a rail link that carried a `minPrice` forward without a
   * `currency` produced precisely the URL the invariant forbids, and two people
   * opening it saw different result sets.
   *
   * `changes` spreads last so a caller can still override — which the currency
   * chips do, and which is the only reason they can.
   */
  const hrefFor = (changes: Parameters<typeof marketplaceHref>[2]) =>
    marketplaceHref(basePath, raw, currencyInUrl ? { currency, ...changes } : changes);

  return (
    <aside className="flex flex-col gap-6" aria-label="Filters">
      <Section title="Sort">
        <div className="flex flex-col gap-0.5">
          {SORTS.map((option) => (
            <RailLink
              key={option.value}
              href={hrefFor({ sort: option.value })}
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
                    href={hrefFor(changes)}
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

      {/*
        Vendor ticket 11 — shown only when a vendor filter is active.
        
        There is no "all sellers" list, deliberately: a marketplace with three hundred vendors
        would have a rail nobody can scan, and the useful direction is the other way round —
        follow a vendor from a card or a storefront. What this provides is the way *back*, which
        is the thing a filtered view without a visible chip does not give you.
      */}
      {asArray(raw.vendor).length > 0 && (
        <Section title="Seller">
          <div className="flex flex-col gap-0.5">
            {asArray(raw.vendor).map((slug) => (
              <RailLink
                key={slug}
                href={hrefFor({ vendor: undefined })}
                active
                label={vendorLabels?.get(slug) ?? slug}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Options">
        {/*
          "Free" sits here rather than in the price section on purpose: it is a
          state a customer looks for by name, not a number they choose. It is
          still a bound on the same active price underneath, so it is correct
          per currency.
        */}
        <RailLink
          /*
            `currency` is named in the changes rather than left to `hrefFor`, which
            would not add it: this link is what *creates* the bound, so while it is
            being built `currencyInUrl` is still false. "Free" is a bound on the
            price in this currency, so a shared `?free=true` carrying no currency
            shows a different catalogue to a viewer whose cookie says otherwise.
          */
          href={hrefFor(raw.free === "true" ? { free: undefined } : { free: true, currency })}
          active={raw.free === "true"}
          label="Free"
        />
        <RailLink
          href={hrefFor({
            customisable: raw.customisable === "true" ? undefined : true,
          })}
          active={raw.customisable === "true"}
          label="Can be adapted"
        />
      </Section>

      <Section title={`Price (${currency})`}>
        <PriceFilter basePath={basePath} raw={raw} currency={currency} />
      </Section>

      {/*
        Currency is the one control here that is not a toggle.

        ## The active chip is not a link

        It used to be, and its href removed the parameter — so **clicking the
        currency you were already in switched you back to GBP**. That is toggle
        behaviour, borrowed from the term links around it, and currency has no
        "off" state to toggle into: you are always seeing prices in something.
        A `<span>` says so, and cannot be clicked into a surprise.

        ## And the others are plain `<a>`, not `<Link>`

        Load-bearing, not an oversight. The choice is persisted by `proxy.ts`,
        which can only tell a real navigation from a speculative one by
        `sec-fetch-dest`. A `<Link>` **click** sends `empty` — byte for byte the
        same as the **prefetch** Next fires when the same href scrolls into view.
        There is no header separating them, so a gate that accepted the click
        would also accept merely looking at the rail, and your currency would
        change on scroll.

        A document navigation sends `document`, which is unambiguous. The cost is
        one full page load on an action taken about once a session — cheaper than
        the alternative, which is a preference that either never sticks or sticks
        without being asked for.
      */}
      <Section title="Currency">
        <div className="flex gap-1.5">
          {STOREFRONT_CURRENCIES.map((code) =>
            code === currency ? (
              <span key={code} aria-current="true" className={`${CHIP} ${CHIP_ACTIVE}`}>
                {code}
              </span>
            ) : (
              <a
                key={code}
                href={hrefFor({ currency: code })}
                className={`${CHIP} text-subtle`}
              >
                {code}
              </a>
            ),
          )}
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

const CHIP = "border-border rounded-lg border px-2.5 py-1 font-mono text-[11.5px]";
const CHIP_ACTIVE = "border-[var(--signal)] text-[var(--signal)]";

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

/*
 * The list this used to hold inline now lives in `query.ts` as `FILTER_KEYS`.
 *
 * It had already drifted once — vendor ticket 04 added the `vendor` dimension and missed the copy
 * here, so "Clear all filters" did not appear for a vendor-only filter, which is a view with no way
 * back out of it. The mobile drawer needs the same list to badge its trigger, and a third copy is
 * where that stops being a near miss.
 */
function hasAnyFilter(raw: RawSearchParams): boolean {
  return activeFilterCount(raw) > 0;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
