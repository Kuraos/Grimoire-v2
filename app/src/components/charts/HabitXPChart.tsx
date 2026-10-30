import { useMemo } from "react";
import { Area, AreaChart, ChartTooltip, Grid, XAxis, YAxis } from "../bklit";
import { ChartEmpty, CURVE, fixedHeight, isoDay, MARGIN } from "./kit";

/**
 * Cumulative XP over time for a single habit. `series` comes from the backend's
 * xp_log (exact amounts, including streak multipliers and undo reversals).
 */
export function HabitXPChart({ series }: { series: { date: string; xp: number }[] }) {
  const rows = useMemo(() => series.map((d) => ({ date: isoDay(d.date), xp: d.xp })), [series]);
  if (rows.length === 0) return <ChartEmpty>Sin datos todavía.</ChartEmpty>;
  return (
    <AreaChart data={rows} margin={{ ...MARGIN, top: 8 }} {...fixedHeight(140)}>
      <Grid horizontal numTicksRows={3} />
      <Area dataKey="xp" curve={CURVE} stroke="var(--gr-arcane)" fill="var(--gr-arcane)" strokeWidth={2} gradientToOpacity={0.02} />
      <XAxis numTicks={4} tickMode="domain" />
      <YAxis numTicks={3} />
      <ChartTooltip rows={(p: Record<string, unknown>) => [{ color: "var(--gr-arcane)", label: "XP acumulado", value: p.xp as number }]} />
    </AreaChart>
  );
}
