import { useMemo } from "react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid, YAxis } from "../bklit";
import { formatVolume, type WeightUnit } from "../../utils";
import type { MuscleGroup, VolumeWeek } from "../../types";
import { ChartEmpty, ChartLegend, fixedHeight, isoDay, MARGIN } from "./kit";

/**
 * El volumen semanal de fuerza, apilado por grupo muscular.
 *
 * «De fuerza» y no «de entrenamiento»: el volumen es kg×reps y sólo lo producen
 * las series. HEMA y cardio no tienen ninguna, así que llamarlo volumen de
 * entrenamiento dejaría fuera dos tercios del módulo sin avisar.
 *
 * Los colores salen del catálogo de grupos, que se siembra con la paleta FRÍA de
 * datos. **Ninguno es dorado, y no puede serlo**: una rampa que acaba en oro
 * significa avance hacia una recompensa, y más volumen no es inequívocamente
 * mejor —una semana de carga altísima es tan probable que sea una lesión en
 * camino como un buen mes—. Es el mismo razonamiento por el que el gasto diario
 * del erario acaba en ámbar y no en oro.
 */
export function VolumeByGroup({ weeks, groups, unit }: {
  weeks: VolumeWeek[];
  groups: MuscleGroup[];
  unit: WeightUnit;
}) {
  const div = unit === "lb" ? 453.59237 : 1000;

  const { rows, used, scale, axisUnit } = useMemo(() => {
    const seen = new Set<number>();
    // El eje se escala escalando el DATO, no la etiqueta: en toneladas las
    // marcas salen redondas solas, y redondear kilos al pintarlos daba un eje
    // de 0·5·9·14·18, números que no son una escala.
    const totals = weeks.map((w) =>
      w.groups.reduce((a, g) => a + Math.max(0, g.volume_g), 0) / div);
    const scale = Math.max(0, ...totals) >= 2000 ? 1000 : 1;
    const axisUnit = scale === 1000 ? "t" : unit;

    const rows = weeks.map((w) => {
      const row: Record<string, number | Date> = { week: isoDay(w.week_start) };
      for (const g of w.groups) {
        if (g.volume_g <= 0) continue;
        // Las series de un ejercicio sin grupo asignado no se pierden ni se
        // reparten: van a su propia pila, visible y sin color de nadie.
        const key = g.muscle_group_id == null ? "sin" : `g${g.muscle_group_id}`;
        if (g.muscle_group_id != null) seen.add(g.muscle_group_id);
        row[key] = ((row[key] as number) ?? 0) + g.volume_g / div / scale;
      }
      return row;
    });
    const used = groups.filter((g) => seen.has(g.id)).map((g) => ({ key: `g${g.id}`, name: g.name, color: g.color }));
    const hasLoose = rows.some((r) => r.sin != null);
    // Bklit necesita la clave en cada fila; un grupo ausente esa semana vale 0.
    const all = hasLoose ? [...used, { key: "sin", name: "Sin grupo", color: "var(--gr-ink-faint)" }] : used;
    rows.forEach((r) => all.forEach((g) => { r[g.key] ??= 0; }));
    return { rows, scale, axisUnit, used: all };
  }, [weeks, groups, div, unit]);

  if (used.length === 0) {
    return <ChartEmpty>Ninguna serie anotada todavía. El volumen sale de las series, no de las sesiones.</ChartEmpty>;
  }

  return (
    <>
      <BarChart data={rows} xDataKey="week" stacked margin={{ ...MARGIN, left: 38 }} barGap={0.3} {...fixedHeight(200)}>
        <Grid horizontal numTicksRows={4} />
        {used.map((g) => <Bar key={g.key} dataKey={g.key} fill={g.color} lineCap="butt" />)}
        <YAxis numTicks={4} formatValue={(v) => String(v)} />
        <BarXAxis maxLabels={6} />
        <ChartTooltip
          rows={(p: Record<string, unknown>) =>
            used
              .filter((g) => (p[g.key] as number) > 0)
              .map((g) => ({ color: g.color, label: g.name, value: formatVolume(Math.round((p[g.key] as number) * scale * div), unit) }))}
        />
      </BarChart>
      {/* La unidad del eje NO es una serie: va al final y en cursiva, que es
          como esta app marca una nota en una leyenda. */}
      <ChartLegend inset={38} items={used.map((g) => ({ label: g.name, color: g.color }))} note={`eje en ${axisUnit}`} />
    </>
  );
}
