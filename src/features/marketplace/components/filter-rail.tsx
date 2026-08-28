import Link from "next/link";
import type { Route } from "next";
import { X } from "lucide-react";
import { SortSelect } from "./sort-select";
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

/** Offered only alongside a search query — see `sortOptions`. */
const RELEVANCE_SORT = { value: "relevance", label: "Best match" } as const;

const SORTS: Array<{ value: MarketplaceSort; label: string }> = [
  { value: "latest", label: "Newest" },
  { value: "popular", label: "Most bought" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

/**
 * The sidebar — the browse dimensions, and nothing else.
 *
 * ## Why it is only taxonomy now
 *
 * It used to hold everything: sort, price, currency, the two options, the seller
 * chip and the escape hatch, on top of four term lists. That is a column a
 * visitor has to *read* before they can use it, and once it gained an inner
 * scroll (see `results-section.tsx`) the controls people reach for most were the
 * ones behind the scroll.
 *
 * The cross-cutting controls moved next to the search box, into `<FilterPanel>`
 * behind a single button. What is left here is the one thing a sidebar is
 * genuinely good at: a long, scannable list you browse *by*, always visible,
 * never collapsed.
 *
 * Below `lg` this does not render at all — the same panel carries the taxonomy
 * there. See `FilterPanel`.
 */
/**
 * The browse dimensions — one list, rendered in two places.
 *
 * The sidebar shows it at `lg` and above; the filter panel shows it below `lg`,
 * where there is no sidebar. It was briefly duplicated between the two, which is
 * four term lists and a counting rule in two copies — so it is one component
 * that both call.
 *
 * Counts are the caller's to supply, because the two callers get them at
 * different moments: the sidebar renders inside the boundary that already ran
 * the search, and the panel streams them in separately so its button does not
 * wait on a query. `countableDimensions` decides which dimensions show a number
 * at all — see `dimensionsWithHonestCounts`.
 */
export function FilterTaxonomy({
  raw,
  taxonomy,
  facetCounts,
  countableDimensions,
  hrefFor,
  locked = [],
}: {
  raw: RawSearchParams;
  taxonomy: TaxonomyIndex;
  facetCounts: readonly FacetCount[];
  countableDimensions: readonly FacetCount["dimension"][];
  hrefFor: (changes: Parameters<typeof marketplaceHref>[2]) => string;
  locked?: ReadonlyArray<(typeof DIMENSIONS)[number]["key"]>;
}) {
  const countOf = new Map(
    facetCounts.map((count) => [`${count.dimension}:${count.slug}`, count.count]),
  );

  return (
    <>
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
    </>
  );
}

export function FilterRail({
  basePath,
  raw,
  taxonomy,
  currency,
  currencyInUrl,
  locked = [],
  facetCounts,
  countableDimensions,
}: {
  basePath: string;
  raw: RawSearchParams;
  taxonomy: TaxonomyIndex;
  currency: StorefrontCurrency;
  currencyInUrl: boolean;
  /** Dimensions a landing page owns — rendered as context, not as a control. */
  locked?: ReadonlyArray<(typeof DIMENSIONS)[number]["key"]>;
  facetCounts: readonly FacetCount[];
  countableDimensions: readonly FacetCount["dimension"][];
}) {
  const hrefFor = hrefBuilder(basePath, raw, currency, currencyInUrl);

  return (
    /*
     * A surface of its own, not the page's background.
     *
     * `--surface` against `--background` is the same one-step separation every
     * card on the site uses, and it inherits both themes rather than restating
     * them — white on warm off-white in light, `#141416` on `#0b0b0c` in dark.
     * Without it a sticky column that scrolls independently had no visible edge,
     * so the scroll looked like the page tearing.
     */
    <aside
      className="border-border bg-surface flex flex-col gap-6 rounded-xl border p-4"
      aria-label="Filters"
    >
      <FilterTaxonomy
        raw={raw}
        taxonomy={taxonomy}
        facetCounts={facetCounts}
        countableDimensions={countableDimensions}
        hrefFor={hrefFor}
        locked={locked}
      />
    </aside>
  );
}

/**
 * Everything that is not a browse dimension, behind one button by the search box.
 *
 * Sort, price, currency, the two options, the seller chip and the escape hatch.
 * They have one thing in common that the taxonomy does not: none of them is
 * something you *scan*. Each is a single decision, so each costs a click to reach
 * and nothing to ignore — which is the trade a sidebar cannot make, because a
 * sidebar is always on screen.
 *
 * ## It carries the taxonomy too, but only below `lg`
 *
 * The sidebar is `lg:block`, so without this a phone would have no way to filter
 * by category at all. Rendering the same sections here under `lg:hidden` is what
 * lets the drawer go: one control, every width.
 *
 * **No counts on that copy**, and that is the one real cost of the move. Counts
 * come from the result set, and this panel is rendered beside the search box —
 * outside the Suspense boundary that runs the query — so that the button paints
 * with the static shell rather than waiting on a database round trip. The lists
 * are complete and every term is still clickable; only the numbers are absent,
 * and only on a phone.
 */
export function FilterPanel({
  basePath,
  raw,
  currency,
  currencyInUrl,
  sort,
  vendorLabels,
  taxonomySlot,
}: {
  basePath: string;
  raw: RawSearchParams;
  currency: StorefrontCurrency;
  currencyInUrl: boolean;
  /**
   * The **effective** sort, from `parseMarketplaceQuery` — not `raw.sort`.
   *
   * The rail used to derive it as `raw.sort ?? "latest"`, which disagrees with
   * the parser: with a search query present the pipeline defaults to
   * `"relevance"`. In a list of four links that was a wrong highlight. In a
   * `<select>`, whose closed state *asserts* what is currently applied, it would
   * be a false statement.
   */
  sort: MarketplaceSort;
  /** Slug → display name for any vendor filter in the URL — vendor ticket 11. */
  vendorLabels?: ReadonlyMap<string, string>;
  /** The term lists, streamed in by the caller once the counts resolve. */
  taxonomySlot: React.ReactNode;
}) {
  const hrefFor = hrefBuilder(basePath, raw, currency, currencyInUrl);
  const filterCount = activeFilterCount(raw);
  const sortOptions = raw.q ? [RELEVANCE_SORT, ...SORTS] : SORTS;

  return (
    <div className="flex flex-col gap-6">
      {filterCount > 0 && (
        /*
          First, not last. It is the only control here whose job is to *undo*, and
          it used to sit below every section — about 1,300px down with a full
          taxonomy, and now behind the rail's own inner scroll as well. A rail
          that can put you in a zero-result view and then hides the way out is the
          dead end the drawer's docblock already worries about.

          Still a `<Link>`, not a `<button>`: it is a navigation to `basePath`,
          and making it a button would cost the no-JS guarantee on the one control
          most likely to be reached for when something has gone wrong.

          Naming the count reuses the number the drawer trigger badges, so a
          closed drawer saying "3" and an open one saying "Clear 3 filters" cannot
          disagree.

          It clears `?currency=` too, which looks like a bug and is not: the
          cookie still holds the choice, so the viewer keeps their currency.
          Currency is not a filter, which is why it is absent from `FILTER_KEYS`.
        */
        <Link
          href={basePath as Route}
          className="border-border hover:bg-surface-muted flex h-8 items-center justify-center gap-1.5 rounded-lg border text-[12.5px]"
        >
          <X className="size-3.5" aria-hidden />
          {filterCount === 1 ? "Clear 1 filter" : `Clear ${filterCount} filters`}
        </Link>
      )}
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

      <Section title="Sort">
        <SortSelect action={basePath} value={sort} options={sortOptions}>
          {/*
            `currencyInUrl`, not an unconditional `currency` — and this is the
            subtlest line in the rail.

            The price form always names the currency because it *creates* a bound
            and the URL has to say 50,000 of what. Sorting creates no bound, so
            emitting `?currency=GBP` here would put a currency in the URL that the
            visitor never chose — and with JavaScript off, a document submission
            sends `sec-fetch-dest: document`, which is exactly what `proxy.ts`
            accepts as a deliberate choice and persists to a cookie. With
            JavaScript on it is a router push (`empty`), which the same gate
            ignores. So the bug would exist only for no-JS visitors and would
            never once be seen in development.
          */}
          <CarriedFilters
            raw={raw}
            currency={currency}
            includeCurrency={currencyInUrl}
            omit={["sort", "page"]}
          />
        </SortSelect>
      </Section>
      <Section title={`Price (${currency})`}>
        <PriceFilter basePath={basePath} raw={raw} currency={currency} />
      </Section>

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

      {/*
        The sidebar's job at `lg` and above; here only when there is no sidebar.

        A slot rather than rendered inline, because its counts come from the
        search and this panel is deliberately built without running one — see
        `FilterControls`. The caller streams it in behind its own boundary, so
        the button and the controls above never wait on a query.
      */}
      <div className="flex flex-col gap-6 lg:hidden">{taxonomySlot}</div>
    </div>
  );
}

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
 *
 * Shared by both halves now that the rail is in two pieces, so the sidebar and
 * the panel cannot start building different URLs from the same filters.
 */
function hrefBuilder(
  basePath: string,
  raw: RawSearchParams,
  currency: StorefrontCurrency,
  currencyInUrl: boolean,
) {
  return (changes: Parameters<typeof marketplaceHref>[2]) =>
    marketplaceHref(basePath, raw, currencyInUrl ? { currency, ...changes } : changes);
}

/**
 * The other filters, as hidden inputs.
 *
 * A form submission replaces the query string wholesale, so anything not
 * restated here is silently dropped. Both GET forms in this rail need it, which
 * is why it is a component rather than four lines inlined twice.
 *
 * `page` is always omitted: it is derived, and `marketplaceHref` drops it for the
 * reason recorded there — staying on page 7 of a set that now has two shows an
 * empty grid and reads as "no results".
 *
 * `currency` is the caller's decision, and the two callers differ. See the
 * comment at each call site.
 */
function CarriedFilters({
  raw,
  currency,
  includeCurrency,
  omit,
}: {
  raw: RawSearchParams;
  currency: StorefrontCurrency;
  includeCurrency: boolean;
  omit: readonly string[];
}) {
  const carried = Object.entries(raw).filter(
    ([key]) => !omit.includes(key) && !(includeCurrency && key === "currency"),
  );

  return (
    <>
      {carried.flatMap(([key, value]) =>
        asArray(value).map((item, index) => (
          <input key={`${key}-${index}`} type="hidden" name={key} value={item} />
        )),
      )}
      {includeCurrency && <input type="hidden" name="currency" value={currency} />}
    </>
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
  return (
    <form action={basePath} method="get" className="flex flex-col gap-2">
      {/* Unconditional `currency` here, unlike the sort form: this is the control
          that *creates* the bound, so it has to name what the number is in. */}
      <CarriedFilters
        raw={raw}
        currency={currency}
        includeCurrency
        omit={["minPrice", "maxPrice", "page"]}
      />

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

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
