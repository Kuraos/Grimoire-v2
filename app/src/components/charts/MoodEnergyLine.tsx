import { useMemo } from "react";
import { ChartTooltip, Grid, Line, LineChart, XAxis, YAxis } from "../bklit";
import { ChartEmpty, ChartLegend, CURVE, fixedHeight, isoDay, MARGIN } from "./kit";

/**
 * Energía y ánimo del check-in diario (escala 1–5), con el XP del día de fondo.
 *
 * Energía en arcano y ánimo en verdigrís, como estaban. El XP va en oro, porque
 * se gana, pero discontinuo, fino y en el eje de la derecha: está para dar
 * contexto —¿los días de más XP son los de más energía?—, no para competir con
 * las dos series que se vienen a leer. Recharts lo pintaba como área; Bklit no
 * compone áreas dentro de un gráfico de líneas.
 */
export function MoodEnergyLine({ data }: {
  data: { date: string; energy: number; mood: number; xp: number }[];
}) {
  const rows = useMemo(() => data.map((d) => ({ ...d, date: isoDay(d.date) })), [data]);

  if (!rows.length) return <ChartEmpty>Sin check-ins en el período.</ChartEmpty>;

  return (
    <>
      <LineChart data={rows} margin={{ ...MARGIN, right: 40 }} {...fixedHeight(240)}>
        <Grid horizontal numTicksRows={5} />
        <Line dataKey="xp" yAxisId="right" curve={CURVE} stroke="var(--gr-gilded)" strokeWidth={1.25} dashFromIndex={0} dashArray="4,4" />
        <Line dataKey="energy" curve={CURVE} stroke="var(--gr-arcane)" strokeWidth={2} />
        <Line dataKey="mood" curve={CURVE} stroke="var(--gr-verdigris)" strokeWidth={2} />
        <XAxis numTicks={6} tickMode="domain" />
        <YAxis numTicks={5} />
        <YAxis yAxisId="right" orientation="right" numTicks={4} />
        <ChartTooltip
          rows={(p: Record<string, unknown>) => [
            { color: "var(--gr-arcane)", label: "Energía", value: p.energy as number },
            { color: "var(--gr-verdigris)", label: "Ánimo", value: p.mood as number },
            { color: "var(--gr-gilded)", label: "XP", value: p.xp as number },
          ]}
        />
      </LineChart>
      <ChartLegend
        items={[
          { label: "Energía", color: "var(--gr-arcane)", shape: "line" },
          { label: "Ánimo", color: "var(--gr-verdigris)", shape: "line" },
          { label: "XP del día (eje derecho)", color: "var(--gr-gilded)", shape: "dash" },
        ]}
      />
    </>
  );
}
