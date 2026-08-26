"use client";

import { Area, AreaChart } from "recharts";

/**
 * A trend, at the size of a tile — no axes, no grid, no tooltip.
 *
 * It answers one question ("which way, and how steadily") and the figure beside
 * it answers the other. Adding a tooltip would make a 28px-tall graphic into
 * something worth hovering, which it is not; the dashboard is one click away and
 * has the real chart on it.
 *
 * A flat line is drawn rather than skipped when every value is zero, because a
 * tile whose sparkline disappears reads as a rendering failure rather than as a
 * quiet week.
 */
export function Sparkline({
  values,
  color = "var(--chart-1)",
  width = 96,
  height = 28,
}: {
  values: readonly number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const data = values.map((value, index) => ({ index, value }));

  return (
    <AreaChart
      data={data}
      width={width}
      height={height}
      margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
      // Decorative: the figure beside it carries the information, and a screen
      // reader announcing thirty unlabelled numbers is noise.
      aria-hidden
    >
      <Area
        type="monotone"
        dataKey="value"
        stroke={color}
        strokeWidth={1.5}
        fill={color}
        fillOpacity={0.16}
        dot={false}
        isAnimationActive={false}
      />
    </AreaChart>
  );
}
