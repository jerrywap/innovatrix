/**
 * How a date is written, in one place — the move `money.ts` made for currency.
 *
 * ## The distinction this module exists to force
 *
 * A **day** and a **moment** are different things, and rendering one as the
 * other is wrong in both directions:
 *
 * - A due date is a day. `1 Sep 2026, 00:00` implies a deadline of midnight,
 *   which is a day earlier than anyone means.
 * - A timeline entry is a moment. §70's own example is three events on one
 *   afternoon — `10:31`, `11:15`, `13:42` — and as days they collapse into
 *   three identical labels in arbitrary order. An audit trail that cannot order
 *   its own entries is not one (§90).
 *
 * The old code had no such distinction: a four-line `isoDay()` was copy-pasted
 * into six view modules and truncated everything to `YYYY-MM-DD`. Because it
 * ran in the *view* layer, the time was gone before any component could render
 * it — which is why the fix is a module and not a component.
 *
 * ## Absolute, never relative
 *
 * No "3 days ago". It differs between server and client — they render at
 * different moments — so it flickers at hydration, and it is useless in an
 * audit trail. AGENTS.md requires absolute dates.
 *
 * ## Fixed locale, explicit zone
 *
 * `en-GB` and UTC, so the server and the client agree by construction. That does
 * mean a reader in Lagos sees UTC; stated here rather than left implicit, and
 * the honest fix when it matters is the viewer's own zone, which needs a
 * decision about where that preference is stored.
 */

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_SHORT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const DAY_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

type DateLike = Date | string | number;

function coerce(value: DateLike): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A day: `14 Aug 2026`.
 *
 * For things that genuinely are days — a due date, an expiry, a release date.
 */
export function formatDay(value: DateLike): string {
  const date = coerce(value);
  return date ? DAY.format(date) : "";
}

/**
 * A moment: `14 Aug 2026, 10:31`.
 *
 * For anything where two of them could land on the same day and the order
 * matters — activity, payments, uploads, downloads, audit rows.
 */
export function formatDateTime(value: DateLike): string {
  const date = coerce(value);
  return date ? DAY_TIME.format(date) : "";
}

/**
 * `YYYY-MM-DD`, for a `<input type="date">` or a `<time dateTime>`.
 *
 * The machine-readable form, and the *only* remaining legitimate use of the
 * truncation this module replaced. Named so that a call site which wants it for
 * display is visibly asking for the wrong thing.
 */
export function toDateInputValue(value: DateLike): string {
  const date = coerce(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

/**
 * A month: `Aug 2026`.
 *
 * For an axis tick on a monthly chart, where the day would be noise and the
 * year is the only thing distinguishing one August from the next.
 */
export function formatMonth(value: DateLike): string {
  const date = coerce(value);
  return date ? MONTH.format(date) : "";
}

/**
 * A day without its year: `14 Aug`.
 *
 * Only for a label whose year is already established by its neighbours — an axis
 * tick inside a window shorter than a year, which is the only caller. Anywhere a
 * date stands on its own, `formatDay` is the honest one: a bare "14 Aug" in a
 * table is ambiguous the moment the table spans a new year.
 */
export function formatDayShort(value: DateLike): string {
  const date = coerce(value);
  return date ? DAY_SHORT.format(date) : "";
}
