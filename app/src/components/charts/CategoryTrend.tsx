import { useMemo } from "react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid, YAxis } from "../bklit";
import { formatMoney, MONTHS_ES, moneyDecimals } from "../../utils";
import type { LedgerStats } from "../../types";
import { ChartEmpty, ChartLegend, fixedHeight, MARGIN } from "./kit";

/**
 * Gasto por partida, mes a mes. Barras apiladas: la altura total es el mes y
 * cada tramo su partida, así se ve de una vez si el mes creció y por dónde.
 *
 * Los colores vienen de cada partida (paleta de datos de theme.css). Las cifras
 * del eje se dividen por el exponente de la moneda —el eje habla en unidades
 * mayores— pero el dato sigue siendo entero hasta el último momento: el tooltip
 * formatea los minor originales, no el valor dividido.
 */
export function CategoryTrend({ stats }: { stats: LedgerStats }) {
  const dec = moneyDecimals(stats.currency);

  const { rows, categories } = useMemo(() => {
    const months = [...new Set(stats.series.map((s) => s.month))].sort();
    const cats = new Map<string, string>();
    stats.series.forEach((s) => cats.set(s.name, s.color));
    const names = [...cats.keys()];

    const rows = months.map((m) => {
      const [, mm] = m.split("-").map(Number);
      const row: Record<string, string | number> = { month: MONTHS_ES[mm - 1].slice(0, 3) };
      names.forEach((_, i) => { row[`c${i}`] = 0; row[`m${i}`] = 0; });
      stats.series
        .filter((s) => s.month === m)
        .forEach((s) => {
          const i = names.indexOf(s.name);
          row[`m${i}`] = (row[`m${i}`] as number) + s.total_minor;
          row[`c${i}`] = (row[`m${i}`] as number) / 10 ** dec;
        });
      return row;
    });
    return { rows, categories: [...cats.entries()] };
  }, [stats, dec]);

  if (!rows.length) return <ChartEmpty>Todavía no hay gasto clasificado que comparar.</ChartEmpty>;

  return (
    <>
      <BarChart data={rows} xDataKey="month" stacked margin={{ ...MARGIN, left: 54 }} barWidth={44} {...fixedHeight(230)}>
        <Grid horizontal numTicksRows={4} />
        {categories.map(([, color], i) => (
          <Bar key={i} dataKey={`c${i}`} fill={color || "var(--gr-arcane)"} lineCap="butt" />
        ))}
        <YAxis numTicks={4} formatValue={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
        <BarXAxis showAllLabels />
        <ChartTooltip
          rows={(p: Record<string, unknown>) =>
            categories
              .map(([name, color], i) => ({ name, color, minor: p[`m${i}`] as number }))
              .filter((r) => r.minor > 0)
              .map((r) => ({ color: r.color || "var(--gr-arcane)", label: r.name, value: formatMoney(r.minor, stats.currency) }))}
        />
      </BarChart>
      <ChartLegend inset={54} items={categories.map(([name, color]) => ({ label: name, color: color || "var(--gr-arcane)" }))} />
    </>
  );
}
