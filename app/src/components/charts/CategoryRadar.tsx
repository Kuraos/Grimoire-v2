import { useMemo } from "react";
import NumberFlow from "@number-flow/react";
import { RadarChart } from "../bklit";
import { RadarArea } from "../bklit/charts/radar-area";
import { RadarAxis } from "../bklit/charts/radar-axis";
import { RadarGrid } from "../bklit/charts/radar-grid";
import { RadarLabels } from "../bklit/charts/radar-labels";
import { ChartEmpty } from "./kit";

/**
 * XP por categoría como radar: la pregunta de esta card es el EQUILIBRIO —¿todo
 * sale de lo académico?—, y un polígono la contesta con su forma antes de leer
 * una sola cifra. El donut que había contestaba «qué parte del total», que con
 * cinco porciones parecidas no se distingue a ojo.
 *
 * El polígono va en oro porque es XP: lo que se ganó. Los colores de categoría
 * siguen en la lista de abajo, que además lleva la cifra exacta que el radar,
 * normalizado al máximo, no da.
 */
export function CategoryRadar({ data, colorFor }: {
  data: { category: string; xp: number }[];
  colorFor: (name: string) => string;
}) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.xp - a.xp), [data]);
  const max = Math.max(1, ...sorted.map((d) => d.xp));

  if (sorted.length === 0) return <ChartEmpty>Sin datos.</ChartEmpty>;

  const list = (
    <ul className="mt-2 space-y-1">
      {sorted.map((d) => (
        <li key={d.category} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(d.category) }} />
          <span className="truncate text-[var(--text-body)]">{d.category}</span>
          <span className="ml-auto tabular text-[var(--gr-gilded)]"><NumberFlow value={d.xp} locales="es" /> XP</span>
        </li>
      ))}
    </ul>
  );

  // Un radar de dos ejes es una raya: con menos de tres categorías basta la lista.
  if (sorted.length < 3) return list;

  return (
    <>
      <div className="mx-auto max-w-[240px]">
        <RadarChart
          data={[{ label: "XP", color: "var(--gr-gilded)", values: Object.fromEntries(sorted.map((d) => [d.category, (d.xp / max) * 100])) }]}
          metrics={sorted.map((d) => ({ key: d.category, label: d.category }))}
          levels={4}
          margin={34}
        >
          <RadarGrid showLabels={false} stroke="var(--gr-edge)" strokeOpacity={1} />
          <RadarAxis stroke="var(--gr-edge)" strokeOpacity={1} />
          <RadarLabels fontSize={11} offset={14} />
          <RadarArea index={0} color="var(--gr-gilded)" />
        </RadarChart>
      </div>
      {list}
    </>
  );
}
