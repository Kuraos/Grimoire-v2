import { useMemo } from "react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid, YAxis } from "../bklit";
import { fixedHeight, isoDay, MARGIN } from "./kit";

/** XP ganado por día. Las barras crecen escalonadas al entrar (Bklit). */
export function XPBarChart({ data }: { data: { date: string; xp: number }[] }) {
  const rows = useMemo(() => data.map((d) => ({ date: isoDay(d.date), xp: d.xp })), [data]);
  return (
    <BarChart data={rows} xDataKey="date" margin={MARGIN} barGap={0.25} {...fixedHeight(220)}>
      <Grid horizontal numTicksRows={4} />
      <Bar dataKey="xp" fill="var(--gr-arcane)" lineCap={2} />
      <YAxis numTicks={4} />
      <BarXAxis maxLabels={7} />
      <ChartTooltip rows={(p: Record<string, unknown>) => [{ color: "var(--gr-arcane)", label: "XP", value: p.xp as number }]} />
    </BarChart>
  );
}
