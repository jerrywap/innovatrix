import { statusTone } from "@/components/status-badge";
import { format, isCurrencyCode, money } from "@/lib/money";

/**
 * What crosses the RSC boundary into a chart, and nothing that cannot.
 *
 * Every `/admin` and `/staff` screen before this one is a Server Component with
 * links for interaction, and `data-table.tsx` argues the case at length. Charts
 * are the exception: recharts measures and paints in the browser, so each chart
 * is a `"use client"` leaf. The pages, the filters and the drilldowns stay on the
 * server, which is where the convention actually matters.
 *
 * That boundary sets the shape of everything here. **A function cannot cross it**
 * — React refuses it outright and the shell 500s — and recharts' whole
 * customisation surface is functions: `tickFormatter`, `labelFormatter`, the
 * tooltip's `formatter`. So none of them are props. A caller passes the *name* of
 * a format and the client resolves it, exactly as `NavItem.icon` passes the name
 * of an icon and `nav-icons.ts` resolves it.
 *
 * Bucket labels are the other half: they arrive pre-formatted, because the server
 * has already built them in `fillSeries` and re-deriving a date on the client is
 * how a chart ends up disagreeing with the heading above it.
 */

/** How a number reads. Resolved on the client; never a function prop. */
export type ValueFormat = "count" | "money" | "percent" | "days";

export interface ChartSeries {
  /** Matches a key in `ChartPoint.values`. */
  key: string;
  /** What the legend and tooltip call it. */
  label: string;
  /** A CSS colour — in practice `var(--chart-1)`, so both themes work for free. */
  color: string;
}

export interface ChartPoint {
  /** The bucket, machine-readable. A stable React key, never displayed. */
  at: string;
  /** The axis tick, already formatted by the server. */
  label: string;
  values: Record<string, number>;
}

/**
 * The series palette, in order.
 *
 * `--chart-1..5` were declared in `globals.css` for both themes and used by
 * nothing until now. They are literals rather than aliases on purpose, which is
 * why `theme-tokens.test.ts` exempts them from the shadcn alias rule.
 *
 * Written as `var(...)` straight into `fill` and `stroke`, so switching theme
 * needs no JavaScript and no re-render — the browser resolves it. A palette read
 * from `getComputedStyle` at mount, which is what a chart library usually wants,
 * would be wrong for one paint after every theme change.
 *
 * `--signal` is deliberately absent. `attention.tsx` reserves it — "orange on a
 * dashboard always means 'you'" — and a revenue line in the same colour as the
 * needs-your-attention panel spends that meaning on decoration. `--chart-1`
 * happens to *be* the brand orange, and that is the one place it is allowed,
 * because a chart's primary series is the thing the panel is about.
 */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** Wraps rather than running out, so a sixth series is dim rather than invisible. */
export function seriesColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}

/** Semantic colours for a chart that is *about* success and failure. */
export const OUTCOME_COLORS = {
  good: "var(--chart-4)",
  warn: "var(--warning)",
  bad: "var(--danger)",
  neutral: "var(--chart-3)",
} as const;

const COMPACT = new Intl.NumberFormat("en-GB", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const PLAIN = new Intl.NumberFormat("en-GB");

/**
 * A value, as a human reads it.
 *
 * Money goes through `lib/money` like everything else on the platform —
 * `components.test.ts` holds that rule, and `toFixed` is banned because it is a
 * float and because JPY has no minor unit. A value arriving with an unsupported
 * or missing currency falls back to a plain number rather than throwing: a chart
 * axis is not the place to take down a page over a currency code.
 */
export function formatValue(
  value: number,
  valueFormat: ValueFormat,
  currency?: string,
): string {
  switch (valueFormat) {
    case "money":
      return currency && isCurrencyCode(currency)
        ? format(money(Math.round(value), currency))
        : PLAIN.format(value);
    case "percent":
      // Basis points in, percent out. The platform stores ratios as integers
      // (§84's argument about money, applied to a ratio of money), so the
      // conversion belongs at the point of display and nowhere earlier.
      return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 1)}%`;
    case "days":
      return value === 1 ? "1 day" : `${PLAIN.format(value)} days`;
    case "count":
    default:
      return PLAIN.format(value);
  }
}

/**
 * The same value, short enough for an axis tick.
 *
 * Money loses its minor units here — a y-axis reading "£1.2k" is more useful
 * than one reading "£1,240.00" four times at an angle. The tooltip still shows
 * the exact figure, which is the division of labour that lets the axis be terse.
 */
export function formatTick(value: number, valueFormat: ValueFormat, currency?: string): string {
  if (valueFormat === "money") {
    const symbol = currency && isCurrencyCode(currency) ? currencySymbol(currency) : "";
    const major = value / minorUnitsPer(currency);
    return `${symbol}${COMPACT.format(major)}`;
  }
  if (valueFormat === "percent") return `${Math.round(value / 100)}%`;
  return COMPACT.format(value);
}

function currencySymbol(currency: string): string {
  if (!isCurrencyCode(currency)) return "";
  // Formatting zero and stripping the digits is how the symbol is obtained
  // without a second copy of the currency table living here.
  return format(money(0, currency)).replace(/[\d.,\s]/g, "");
}

function minorUnitsPer(currency: string | undefined): number {
  if (!currency || !isCurrencyCode(currency)) return 1;
  // A currency with no minor unit — JPY — is already in major units, and dividing
  // it by 100 is the `toFixed` bug in a different costume.
  return format(money(1, currency)).includes(".") ? 100 : 1;
}

/**
 * A status's colour, taken from the tone it already has everywhere else.
 *
 * `components.test.ts` holds the rule this exists to keep: *"'cancelled' must not
 * be red on orders and grey on requests."* A chart is the easiest place to break
 * it — a palette assigned by position gives whichever status happens to sort
 * first the brand colour — so status marks read from `statusTone()` and only the
 * tone-to-CSS mapping lives here.
 *
 * `attention` maps to `--signal` deliberately, and it is the one place a chart
 * may use it: on a status breakdown, the attention tone means the same thing it
 * means in `attention.tsx` — somebody has to do something.
 */
export function statusColor(status: string): string {
  switch (statusTone(status)) {
    case "positive":
      return "var(--chart-4)";
    case "negative":
      return "var(--danger)";
    case "attention":
      return "var(--signal)";
    case "progress":
      return "var(--chart-5)";
    case "muted":
      return "var(--border-strong)";
    case "neutral":
    default:
      return "var(--chart-3)";
  }
}
