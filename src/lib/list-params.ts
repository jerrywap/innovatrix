import type { Route } from "next";

/**
 * List state lives in the URL, not in React state — a ticket-04 convention.
 *
 * Four things follow from that, and none of them are available to a component
 * holding `useState`:
 *
 * - A filtered view can be linked, bookmarked and pasted into a message.
 * - Back actually goes back.
 * - The server renders the right rows on the first pass, so there is no
 *   loading flash of the unfiltered list.
 * - Reloading after an action keeps you where you were.
 *
 * This module is the parser. It is pure, so it can be unit-tested and used by
 * both server components and route handlers.
 *
 * **Everything here is untrusted.** These values come from a query string, so
 * every one is clamped or rejected: `?limit=1000000` is a denial-of-service
 * dressed as a preference (§94, no unbounded reads), and `?sort=password` is
 * an attempt to sort by a column that isn't offered.
 */

export interface ListParams {
  page: number;
  limit: number;
  sort?: string;
  direction: "asc" | "desc";
  q?: string;
  /** Only keys the caller allow-listed. */
  filters: Record<string, string>;
}

export interface ListParamsOptions {
  defaultLimit?: number;
  maxLimit?: number;
  /** Sortable columns. Anything else in `?sort=` is dropped. */
  sortable?: readonly string[];
  defaultSort?: string;
  defaultDirection?: "asc" | "desc";
  /** Filter keys this screen understands. Anything else is dropped. */
  filterable?: readonly string[];
}

/** What a Next.js page receives after awaiting `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const MAX_QUERY_LENGTH = 120;

export function parseListParams(
  raw: RawSearchParams,
  options: ListParamsOptions = {},
): ListParams {
  const {
    defaultLimit = 25,
    maxLimit = 100,
    sortable = [],
    defaultSort,
    defaultDirection = "desc",
    filterable = [],
  } = options;

  const page = clampInt(first(raw.page), 1, 1, 10_000);
  const limit = clampInt(first(raw.limit), defaultLimit, 1, maxLimit);

  const requestedSort = first(raw.sort);
  const sort = requestedSort && sortable.includes(requestedSort) ? requestedSort : defaultSort;

  const requestedDirection = first(raw.direction);
  const direction =
    requestedDirection === "asc" || requestedDirection === "desc"
      ? requestedDirection
      : defaultDirection;

  // Trimmed and capped: a search box is not a place to post a novel, and an
  // unbounded string reaches a regex or a text index downstream.
  const rawQuery = first(raw.q)?.trim();
  const q = rawQuery ? rawQuery.slice(0, MAX_QUERY_LENGTH) : undefined;

  const filters: Record<string, string> = {};
  for (const key of filterable) {
    const value = first(raw[key])?.trim();
    if (value) filters[key] = value.slice(0, MAX_QUERY_LENGTH);
  }

  return {
    page,
    limit,
    direction,
    ...(sort ? { sort } : {}),
    ...(q ? { q } : {}),
    filters,
  };
}

/** Rows to skip. Paired with `limit` this is the only pagination we do. */
export function skipFor(params: ListParams): number {
  return (params.page - 1) * params.limit;
}

/** Mongoose sort object, or undefined when the screen has no default. */
export function sortSpec(params: ListParams): Record<string, 1 | -1> | undefined {
  if (!params.sort) return undefined;
  return { [params.sort]: params.direction === "asc" ? 1 : -1 };
}

/**
 * Build the href for a changed parameter, preserving the rest.
 *
 * Changing a filter resets to page 1 — staying on page 7 of a list that now has
 * two pages shows an empty screen and reads as a bug.
 */
export function listHref(
  pathname: Route,
  current: RawSearchParams,
  changes: Record<string, string | number | undefined>,
): Route {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    const single = first(value);
    if (single) next.set(key, single);
  }

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
  }

  if (!("page" in changes)) next.delete("page");

  const query = next.toString();
  // `Route` covers `${StaticRoutes}${SearchOrHash}`, so the template is a valid
  // route — TypeScript just can't see through the runtime concatenation.
  return (query ? `${pathname}?${query}` : pathname) as Route;
}

/** Next.js gives `string | string[]`; a repeated key takes the first value. */
function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function clampInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
