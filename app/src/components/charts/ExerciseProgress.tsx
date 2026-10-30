import { useMemo } from "react";
import { ChartTooltip, Grid, Line, LineChart, XAxis, YAxis } from "../bklit";
import { formatWeight, type WeightUnit } from "../../utils";
import type { ExercisePoint } from "../../types";
import { ChartEmpty, ChartLegend, CURVE, fixedHeight, isoDay, MARGIN, PointMarks } from "./kit";

/**
 * La progresión de un ejercicio: peso máximo medido y 1RM estimado.
 *
 * Las dos líneas van en TINTA, no en arcano. Es dato, y la ley del acento manda:
 * el arcano es estado del sistema —foco, selección, navegación— y usarlo aquí
 * habría hecho que la mitad de la gráfica pareciera un control.
 *
 * La distinción entre las dos la hace el trazo, no el color: el peso máximo es
 * tinta brillante y continua porque se midió; el 1RM es tinta tenue y
 * discontinua porque se calculó. Un usuario que no lea la leyenda sigue sabiendo
 * cuál de las dos es una suposición.
 *
 * Los récords se marcan con un rombo de tinta. Se DIBUJAN, no se premian: un
 * récord sin meta declarada de antemano es circunstancia, y el oro del módulo
 * está reservado a las metas que el usuario fijó antes de cumplirlas.
 *
 * El eje se ajusta a los datos y Bklit lo redondea (`nice()`), así que las marcas
 * caen en números de escala en vez de 68·83·110.
 */
export function ExerciseProgress({ points, unit }: {
  points: ExercisePoint[];
  unit: WeightUnit;
}) {
  const div = unit === "lb" ? 453.59237 : 1000;
  const rows = useMemo(
    () => points.map((p) => ({
      date: isoDay(p.occurred_on),
      top: p.top_weight_g / div,
      est: p.est_1rm_g / div,
      record: p.is_record,
      lowConfidence: p.low_confidence,
    })),
    [points, div],
  );

  if (rows.length < 2) {
    return (
      <ChartEmpty>
        {rows.length === 0
          ? "Sin series de este ejercicio todavía."
          : "Una sola sesión no dibuja una curva. Vuelve cuando tenga dos."}
      </ChartEmpty>
    );
  }

  const w = (v: unknown) => formatWeight(Math.round((v as number) * div), unit);
  return (
    <>
      <LineChart data={rows} yBaseline="data" margin={{ ...MARGIN, top: 16 }} {...fixedHeight(210)}>
        <Grid horizontal numTicksRows={5} />
        {/* El estimado se dibuja primero para que el medido quede encima: si se
            cruzan, lo que importa leer es el dato real. */}
        <Line dataKey="est" curve={CURVE} stroke="var(--gr-ink-faint)" strokeWidth={1.5} dashFromIndex={0} dashArray="5,4" />
        <Line dataKey="top" curve={CURVE} stroke="var(--gr-ink-bright)" strokeWidth={2} />
        {/* Ámbar sobre la estimación floja: por encima de diez repeticiones
            Epley pierde precisión, y el ámbar es advertencia sobre el dato —no
            una recompensa ni un error—. */}
        <PointMarks dataKey="est" shape="ring" color="var(--gr-amber)" when={(d) => d.lowConfidence === true} />
        <PointMarks dataKey="top" shape="dot" color="var(--gr-ink-bright)" when={(d) => d.record !== true} />
        {/* El récord es un ROMBO, no un punto más gordo: a 4px de radio un
            círculo grande y uno pequeño no se distinguen. En tinta: un récord
            sin meta declarada es dato, no medalla. */}
        <PointMarks dataKey="top" shape="rhombus" color="var(--gr-ink-bright)" when={(d) => d.record === true} />
        <XAxis numTicks={5} tickMode="domain" />
        <YAxis numTicks={6} formatValue={(v) => String(Math.round(v))} />
        <ChartTooltip
          rows={(p: Record<string, unknown>) => [
            { color: "var(--gr-ink-bright)", label: p.record ? "Peso máximo · récord" : "Peso máximo", value: w(p.top) },
            { color: p.lowConfidence ? "var(--gr-amber)" : "var(--gr-ink-faint)", label: "1RM estimado", value: w(p.est) },
          ]}
        />
      </LineChart>
      <ChartLegend
        inset={38}
        items={[
          { label: "Peso máximo", color: "var(--gr-ink-bright)", shape: "line" },
          { label: "1RM estimado (Epley)", color: "var(--text-faint)", shape: "dash" },
          { label: "Récord personal", color: "var(--gr-ink-bright)", shape: "rhombus" },
          { label: "Más de 10 reps: estimación floja", color: "var(--warning)", shape: "ring" },
        ]}
      />
    </>
  );
}
