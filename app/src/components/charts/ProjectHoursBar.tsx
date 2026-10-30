import { useMemo } from "react";
import { Bar, BarChart, BarYAxis, ChartTooltip, Grid } from "../bklit";
import { ChartEmpty, fixedHeight } from "./kit";

/**
 * Horas de foco por proyecto, en barras horizontales con el color del proyecto.
 *
 * Bklit pinta cada serie de un color, así que cada proyecto es su propia serie
 * apilada: en cada fila sólo la suya tiene valor y las demás valen cero.
 */
export function ProjectHoursBar({ data }: { data: { project: string; color: string; hours: number }[] }) {
  const rows = useMemo(
    () => data.map((d, i) => ({ project: d.project, hours: d.hours, ...Object.fromEntries(data.map((_, j) => [`p${j}`, i === j ? d.hours : 0])) })),
    [data],
  );
  if (!data.length) return <ChartEmpty>Sin horas de foco registradas.</ChartEmpty>;
  return (
    <BarChart
      data={rows} xDataKey="project" orientation="horizontal" stacked barWidth={16}
      margin={{ top: 4, right: 12, bottom: 4, left: 110 }} {...fixedHeight(Math.max(120, data.length * 38))}
    >
      <Grid vertical horizontal={false} numTicksColumns={4} />
      {data.map((d, j) => <Bar key={j} dataKey={`p${j}`} fill={d.color || "var(--gr-arcane)"} lineCap={2} />)}
      <BarYAxis />
      <ChartTooltip
        rows={(p: Record<string, unknown>) => {
          const d = data.find((x) => x.project === p.project);
          return [{ color: d?.color || "var(--gr-arcane)", label: "Foco", value: `${p.hours} h` }];
        }}
      />
    </BarChart>
  );
}
