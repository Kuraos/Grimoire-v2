import { useMemo } from "react";
import { isoDate, MONTHS_ES } from "../../utils";
import { chartPalette, toRgb } from "../../theme-tokens";

/**
 * GitHub-style heatmap: 53 weeks × 7 days, coloured by completion count.
 */
export function HabitHeatmap({ data, weeks = 53 }: {
  data: { date: string; count: number }[];
  weeks?: number;
}) {
  const { columns, max, months } = useMemo(() => {
    const map = new Map(data.map((d) => [d.date, d.count]));
    const max = Math.max(1, ...data.map((d) => d.count));

    // last day = today; align grid to end on the current week (Mon-start)
    const today = new Date();
    const end = new Date(today);
    // move to Sunday (end of current Mon-start week)
    end.setDate(end.getDate() + ((7 - ((end.getDay() + 6) % 7)) % 7));
    const totalDays = weeks * 7;
    const start = new Date(end);
    start.setDate(start.getDate() - totalDays + 1);

    const cols: { date: string; count: number }[][] = [];
    let cursor = new Date(start);
    for (let w = 0; w < weeks; w++) {
      const col: { date: string; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const iso = isoDate(cursor);
        col.push({ date: iso, count: map.get(iso) ?? 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(col);
    }

    /* Rótulo de mes sobre la primera columna de cada mes.
     *
     * Sale de las columnas y no de doce cajas de ancho fijo: las semanas no
     * caen en múltiplos exactos de mes, así que un reparto uniforme se desvía
     * hasta media columna según el año y el rótulo acaba señalando el mes de
     * al lado. Anclado a la columna, no puede desalinearse.
     *
     * Se salta el primer mes si su columna arranca a menos de dos semanas del
     * borde: ahí el rótulo se sale del lienzo por la izquierda. */
    const months: { col: number; label: string }[] = [];
    let lastMonth = -1;
    cols.forEach((col, i) => {
      const m = new Date(col[0].date + "T00:00").getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        if (i > 1) months.push({ col: i, label: MONTHS_ES[m].slice(0, 3) });
      }
    });

    return { columns: cols, max, months };
  }, [data, weeks]);

  // La rampa se interpola entre dos tokens del tema, no entre hexadecimales
  // sueltos: antes terminaba en el morado de la config vieja (#9b7fc4).
  const c = chartPalette();
  const from = toRgb(c.surfaceRaised);
  const to = toRgb(c.arcane);

  const color = (count: number) => {
    if (count <= 0) return "var(--gr-surface-raised)";
    const t = Math.min(1, count / max);
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
    return `rgb(${lerp(from[0], to[0])},${lerp(from[1], to[1])},${lerp(from[2], to[2])})`;
  };

  const todayIso = isoDate(new Date());

  // 11px de celda + 3px de hueco: el paso con el que se colocan los rótulos.
  const STEP = 14;

  return (
    <div className="overflow-x-auto">
      <div className="relative mb-1.5 h-4" style={{ width: columns.length * STEP }}>
        {months.map((m) => (
          <span
            key={m.col}
            className="absolute top-0 font-label text-2xs text-[var(--text-faint)]"
            style={{ left: m.col * STEP }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="flex gap-[3px]">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {col.map((cell) => (
              <div
                key={cell.date}
                title={`${cell.date}: ${cell.count} completado(s)`}
                className="h-[11px] w-[11px] rounded-xs"
                style={{
                  background: cell.date > todayIso ? "transparent" : color(cell.count),
                  outline: cell.date === todayIso ? "1px solid var(--purple-main)" : "none",
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
