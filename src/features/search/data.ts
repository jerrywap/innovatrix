/**
 * Openers for the bare `/search` page.
 *
 * ## Editorial, not derived — and the derived option is a trap
 *
 * The obvious source is `SearchLog` via `topMissedSearches`. It must not be
 * used: that collection is written **only** by `logZeroResultSearch`, so it is
 * by construction the list of searches that found *nothing*. Surfacing it would
 * route visitors straight into guaranteed-empty result sets. It is a
 * product-roadmap input and nothing else.
 *
 * ## `label` and `q` are separate for the reason `HERO_CHIPS` gives
 *
 * What reads well on a pill and what the `$text` index scores are different
 * strings. The index weights `name` 10, `summary` 5 and `descriptionText` 1, so
 * the query wants the noun a listing would actually use.
 *
 * Chosen to span both catalogues deliberately: the point of this page is that
 * one question can be answered by a whole application *or* by a front-end, and a
 * list of openers that only ever returned scripts would teach the opposite.
 */
export const SEARCH_OPENERS: ReadonlyArray<{ label: string; q: string }> = [
  { label: "Customer records", q: "crm" },
  { label: "Taking bookings", q: "booking" },
  { label: "Invoicing", q: "invoicing" },
  { label: "An admin dashboard", q: "admin dashboard" },
  { label: "A landing page", q: "landing page" },
  { label: "An online shop", q: "ecommerce" },
  { label: "Staff rotas", q: "rota" },
  { label: "Property listings", q: "property" },
];
