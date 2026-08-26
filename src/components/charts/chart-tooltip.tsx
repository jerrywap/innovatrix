"use client";

import { formatValue, type ValueFormat } from "./chart-types";

/**
 * The hover card, shared by every chart.
 *
 * Recharts' default tooltip is a white box with a black border in both themes,
 * which is unreadable on the dark ground. Replacing it is also the only way to
 * get exact figures through `lib/money` — the axis is deliberately terse
 * ("£1.2k") and this is where the real number appears.
 *
 * Zero rows are dropped rather than listed. A stacked bar with nine statuses in
 * the legend and two in the bucket should show two lines, not seven zeroes and
 * the answer buried among them.
 */
interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  valueFormat,
  currency,
  hideZero = true,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  valueFormat: ValueFormat;
  currency?: string;
  hideZero?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = payload
    .map((entry) => ({
      key: String(entry.dataKey ?? entry.name ?? ""),
      name: String(entry.name ?? entry.dataKey ?? ""),
      value: typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0),
      color: entry.color,
    }))
    .filter((row) => (hideZero ? row.value !== 0 : true));

  if (rows.length === 0) return null;

  return (
    <div className="border-border bg-surface shadow-lift pointer-events-none rounded-lg border px-3 py-2 text-[12px]">
      {label !== undefined && (
        <p className="text-subtle font-mono text-[10px] tracking-[0.1em] uppercase">{label}</p>
      )}
      <ul className="mt-1 flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: row.color }}
              />
              <span className="text-muted-foreground">{row.name}</span>
            </span>
            <span className="font-mono tabular-nums">
              {formatValue(row.value, valueFormat, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
