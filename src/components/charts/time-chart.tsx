"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./chart-tooltip";
import { formatTick, type ChartPoint, type ChartSeries, type ValueFormat } from "./chart-types";

/**
 * A measure over time — the shape most of these panels are.
 *
 * One component for lines, areas and stacked bars because the axes, the grid,
 * the tooltip and the scroll behaviour are identical and only the mark differs.
 * Three components would be three copies of the y-axis width calculation.
 *
 * ## Why it scrolls rather than squeezes
 *
 * Thirty daily columns inside 390px is not a chart, it is a texture. The plot is
 * given a minimum width from its own point count and `ChartFrame` scrolls it, so
 * a phone shows a readable window of a real chart instead of an unreadable whole
 * one. That is also why there is no `ResponsiveContainer`: it would fight the
 * minimum width, which is the thing making this legible.
 */
export function TimeChart({
  points,
  series,
  mark = "line",
  stacked = false,
  valueFormat = "count",
  currency,
  height = 220,
  columnWidth = 26,
}: {
  points: readonly ChartPoint[];
  series: readonly ChartSeries[];
  mark?: "line" | "area" | "bar";
  stacked?: boolean;
  valueFormat?: ValueFormat;
  /** Only meaningful when `valueFormat` is `"money"`; one chart, one currency. */
  currency?: string;
  height?: number;
  columnWidth?: number;
}) {
  // Recharts wants one flat object per point. `ChartPoint.values` stays nested on
  // the server side because that is the honest shape — a bucket has a set of
  // series — and flattening here costs one pass over at most 365 rows.
  const data = useMemo(
    () => points.map((point) => ({ at: point.at, label: point.label, ...point.values })),
    [points],
  );

  const width = Math.max(320, points.length * columnWidth + 64);
  const shared = { data, margin: { top: 8, right: 8, bottom: 0, left: 0 } };

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 10.5, fill: "var(--subtle)" }}
        tickLine={false}
        axisLine={{ stroke: "var(--border)" }}
        interval="preserveStartEnd"
        minTickGap={20}
      />
      <YAxis
        tick={{ fontSize: 10.5, fill: "var(--subtle)" }}
        tickLine={false}
        axisLine={false}
        width={56}
        // Built here, not passed in: a function cannot cross the RSC boundary.
        tickFormatter={(value: number) => formatTick(value, valueFormat, currency)}
      />
      <Tooltip
        cursor={{ fill: "var(--surface-muted)", stroke: "var(--border)" }}
        content={<ChartTooltip valueFormat={valueFormat} currency={currency} />}
      />
    </>
  );

  return (
    <div style={{ minWidth: width, height }}>
      {mark === "bar" ? (
        <BarChart {...shared} width={width} height={height} accessibilityLayer>
          {axes}
          {series.map((one) => (
            <Bar
              key={one.key}
              dataKey={one.key}
              name={one.label}
              fill={one.color}
              stackId={stacked ? "stack" : undefined}
              radius={stacked ? 0 : [3, 3, 0, 0]}
              maxBarSize={38}
            />
          ))}
        </BarChart>
      ) : mark === "area" ? (
        <AreaChart {...shared} width={width} height={height} accessibilityLayer>
          {axes}
          {series.map((one) => (
            <Area
              key={one.key}
              type="monotone"
              dataKey={one.key}
              name={one.label}
              stroke={one.color}
              fill={one.color}
              fillOpacity={0.14}
              strokeWidth={1.75}
              stackId={stacked ? "stack" : undefined}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          ))}
        </AreaChart>
      ) : (
        <LineChart {...shared} width={width} height={height} accessibilityLayer>
          {axes}
          {series.map((one) => (
            <Line
              key={one.key}
              type="monotone"
              dataKey={one.key}
              name={one.label}
              stroke={one.color}
              strokeWidth={1.75}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          ))}
        </LineChart>
      )}
    </div>
  );
}
