"use client";

import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { ChartTooltip } from "./chart-tooltip";
import { formatValue, type ValueFormat } from "./chart-types";

/**
 * A composition — how one whole divides.
 *
 * The one place a ring genuinely beats a bar list: "issued / accepted /
 * rejected / expired" is read as parts of a whole, and the whole is the point.
 * Rankings use `BarList` instead, because there the comparison is between rows
 * rather than against a total.
 *
 * The total sits in the middle rather than above, because a donut without its
 * total is a picture of proportions nobody can convert back into figures. Slices
 * are not links — the legend beside it is, which is `BarList`'s job on the page.
 */
export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  slices,
  valueFormat = "count",
  currency,
  totalLabel = "total",
  size = 176,
}: {
  slices: readonly DonutSlice[];
  valueFormat?: ValueFormat;
  currency?: string;
  totalLabel?: string;
  size?: number;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = size / 2;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <PieChart width={size} height={size} accessibilityLayer>
        <Pie
          data={slices as DonutSlice[]}
          dataKey="value"
          nameKey="label"
          cx={radius - 1}
          cy={radius - 1}
          innerRadius={radius * 0.62}
          outerRadius={radius - 2}
          paddingAngle={total > 0 ? 1.5 : 0}
          strokeWidth={0}
          isAnimationActive={false}
        >
          {slices.map((slice) => (
            <Cell key={slice.key} fill={slice.color} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip valueFormat={valueFormat} currency={currency} />} />
      </PieChart>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[22px] leading-none tracking-[-0.03em] tabular-nums">
          {formatValue(total, valueFormat, currency)}
        </span>
        <span className="text-subtle mt-1 font-mono text-[9.5px] tracking-[0.14em] uppercase">
          {totalLabel}
        </span>
      </div>
    </div>
  );
}
