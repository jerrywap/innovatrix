"use server";

import { z } from "zod";
import { PRODUCT_CATALOGUES } from "@/lib/db/enums";
import type { CatalogueScope } from "@/config/catalogue";
import { searchMarketplaceRows } from "@/services/marketplace";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { parseMarketplaceQuery, type RawSearchParams } from "@/services/marketplace/query";
import { ProductCardTile } from "./components/product-card";

/**
 * The next page of the grid, as **server-rendered cards**.
 *
 * ## Why a Server Action and not a route handler
 *
 * A route handler can only return JSON, which means the client has to render the
 * cards — so `ProductCardTile` becomes a client component and the money type, the
 * price formatter, the badge logic and every chip's markup ship to the browser.
 * `product-card.tsx`'s own docblock argues against exactly that.
 *
 * A Server Action *is* the RSC boundary. The cards come back as an RSC payload
 * already rendered, and there stays **one** definition of a card, shared by the
 * first page and every appended one. The alternative is two card renderers that
 * agree until they do not.
 *
 * This is a React 19 capability the codebase does not otherwise use. If it
 * misbehaves the retreat is a route handler with JSON, at the client-bundle cost
 * above — a known price, not a redesign.
 *
 * ## It reads no session, and that is the whole point
 *
 * A public catalogue read. It is allowlisted in `action-guards.test.ts` as
 * `ANONYMOUS_BY_DESIGN`, and additionally exempted from that file's "allowlisted
 * actions still read the session" rule — every other entry there *mutates*
 * something on behalf of an anonymous owner, so a read-only action is a category
 * the test does not model. Adding a `getSession()` call purely to satisfy it would
 * be a lie in the source about what this endpoint depends on.
 *
 * ## Everything untrusted goes back through `parseMarketplaceQuery`
 *
 * The query arrives as **one string** — the page's own search string — rather than
 * as a parsed object. That keeps the payload obviously bounded and means the
 * server does its own parsing rather than trusting a shape the client assembled.
 * From there `parseMarketplaceQuery` applies the slug regex,
 * `MAX_TERMS_PER_DIMENSION`, the price clamps and `MAX_PAGE`, exactly as it does
 * for a real navigation.
 *
 * **`forced` is deliberately not a parameter.** A landing page's pinned term
 * reaches here inside the search string, so it goes through `slugs()` like
 * anything else. Passing it as an option would be the one genuine injection route
 * in this file, because `parseMarketplaceQuery` bypasses `slugs()` for `forced` —
 * it trusts the *page* — and the value lands in an `$in`.
 *
 * `catalogue` is validated against the closed set for the same reason, though the
 * stakes are lower: both catalogues are public, so the worst a forged value
 * achieves is template cards in a script grid.
 */

/** Long enough for a heavily filtered listing, short enough to be a bound. */
const MAX_SEARCH_LENGTH = 2000;

const inputSchema = z.object({
  search: z.string().max(MAX_SEARCH_LENGTH),
  catalogue: z.enum([...PRODUCT_CATALOGUES, "all"] as const),
});

export async function appendMarketplacePageAction(
  search: string,
  catalogue: string,
): Promise<React.ReactNode> {
  const parsed = inputSchema.safeParse({ search, catalogue });
  // Nothing rather than an error object: the caller is a scroll observer, and the
  // honest response to a malformed request from one is to append no cards.
  if (!parsed.success) return null;

  const raw = toRawSearchParams(parsed.data.search);
  const currency = await resolveStorefrontCurrency(raw.currency);

  const query = parseMarketplaceQuery(raw, {
    currency,
    catalogue: parsed.data.catalogue as CatalogueScope,
  });

  const cards = await searchMarketplaceRows(query);

  return (
    <>
      {/*
        Where one batch ends and the next begins, for a screen reader — the visual
        equivalent is simply that the grid got longer. Server-rendered here rather
        than added by the client, so the marker and the cards it labels arrive as
        one payload and cannot get out of step.

        `sr-only` is `position: absolute`, so it takes no grid track: dropping this
        into the card grid adds a label, not an empty cell.
      */}
      <p className="sr-only">Page {query.page}</p>
      {cards.map((card) => (
        <ProductCardTile key={card.id} card={card} />
      ))}
    </>
  );
}

/**
 * A query string, as the parser expects it.
 *
 * `URLSearchParams` rather than trusting a client-built object: it is the same
 * decoding the framework does for a real request, so a value that would be one
 * thing on navigation cannot be another thing here.
 *
 * A repeated key becomes an array and a single key a string, matching what
 * `searchParams` hands a page — `parseMarketplaceQuery` accepts either, and
 * feeding it a shape it does not see in production is how the two paths diverge.
 */
function toRawSearchParams(search: string): RawSearchParams {
  const params = new URLSearchParams(search);
  const raw: RawSearchParams = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }

  return raw;
}
