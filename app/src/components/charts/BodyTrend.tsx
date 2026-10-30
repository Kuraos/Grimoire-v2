import { useMemo } from "react";
import { ChartTooltip, Grid, Line, LineChart, XAxis, YAxis } from "../bklit";
import { BODY_METRIC_MILLI } from "../../utils";
import type { BodyMetricSeries } from "../../types";
import { ChartEmpty, ChartLegend, CURVE, fixedHeight, isoDay, MARGIN, PointMarks } from "./kit";

/** Tinta tenue al 55 %: el dato crudo se ve, pero no compite con la tendencia. */
const CRUDO = "color-mix(in srgb, var(--gr-ink-faint) 55%, transparent)";

/**
 * La tendencia de una medida del cuerpo.
 *
 * Dos líneas y ningún color: el dato crudo en tinta tenue, la tendencia en tinta
 * brillante. **Ni verdigrís ni oxblood, ni flechas de subida y bajada.** Un peso
 * que baja no es «bien» y uno que sube no es «mal»: pintarlos de éxito o de
 * peligro convertiría el cuerpo en un marcador, que es exactamente el incentivo
 * perverso que este módulo evita. Aquí no hay oro, ni racha, ni logro.
 *
 * Y no es una gráfica de una línea porque la pregunta no es «¿cuánto peso hoy?»
 * sino «¿esto baja o es ruido?». El peso corporal oscila un kilo entre la mañana
 * y la noche por razones que no tienen nada que ver con entrenar; la media móvil
 * de cuatro medidas es lo único que contesta la pregunta de verdad.
 *
 * El eje se ajusta a los datos (`yBaseline="data"`): desde cero, 70–75 kg sería
 * una raya plana y la pregunta no tendría respuesta.
 */
export function BodyTrend({ series }: { series: BodyMetricSeries }) {
  const rows = useMemo(
    () => series.points.map((p) => ({
      date: isoDay(p.measured_on),
      valor: p.value_milli / BODY_METRIC_MILLI,
      tendencia: p.trend_milli / BODY_METRIC_MILLI,
    })),
    [series],
  );

  if (rows.length < 3) {
    return <ChartEmpty>{rows.length === 0 ? "Sin medidas anotadas." : "Una tendencia necesita tres puntos."}</ChartEmpty>;
  }

  const fmt = (v: unknown) => `${(v as number).toFixed(1)} ${series.unit}`;
  return (
    <>
      <LineChart data={rows} yBaseline="data" margin={MARGIN} {...fixedHeight(200)}>
        <Grid horizontal numTicksRows={4} />
        <Line dataKey="valor" curve={CURVE} stroke={CRUDO} strokeWidth={1} />
        <Line dataKey="tendencia" curve={CURVE} stroke="var(--gr-ink-bright)" strokeWidth={2} />
        <PointMarks dataKey="valor" shape="dot" color="var(--gr-ink-faint)" />
        <XAxis numTicks={5} tickMode="domain" />
        <YAxis numTicks={4} formatValue={(v) => v.toFixed(1)} />
        <ChartTooltip
          rows={(p: Record<string, unknown>) => [
            { color: "var(--gr-ink-faint)", label: "Medida", value: fmt(p.valor) },
            { color: "var(--gr-ink-bright)", label: "Tendencia", value: fmt(p.tendencia) },
          ]}
        />
      </LineChart>
      <ChartLegend
        items={[
          { label: "Tendencia (media de 4)", color: "var(--gr-ink-bright)", shape: "line" },
          { label: "Medida anotada", color: "var(--text-faint)", shape: "line" },
        ]}
      />
    </>
  );
}
