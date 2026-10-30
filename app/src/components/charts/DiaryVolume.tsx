import { useEffect, useState } from "react";
import { Api } from "../../api/endpoints";
import { Card } from "../ui/Card";
import { SectionBand } from "../ui/SectionBand";
import { chartPalette } from "../../theme-tokens";
import { MONTHS_ES } from "../../utils";

/**
 * El volumen: doce meses de arriba abajo, el día del mes de izquierda a
 * derecha, una estrella por entrada escrita y el brillo por su longitud.
 *
 * Lo que la pieza dice no son las estrellas: son **los huecos**. El
 * minicalendario de al lado marca los días con entrada del mes en curso, y eso
 * no deja ver una racha rota en marzo ni un verano entero en blanco. Por eso no
 * se rellenan los días sin escribir con nada —ni un punto tenue, ni una celda
 * de fondo—: el vacío es el dato.
 *
 * Sin penalización, tampoco aquí. No se pinta en rojo lo que falta ni se cuenta
 * cuántos días se dejaron: enseña el año y ya.
 */

const X0 = 44;
const X1 = 268;
const Y0 = 18;
const ROW = 24;

export function DiaryVolume({ today }: { today: string }) {
  const c = chartPalette();
  const [points, setPoints] = useState<{ entry_date: string; length: number }[]>([]);

  useEffect(() => {
    Api.diaryVolume().then(setPoints).catch(() => {});
    // `today` en las dependencias: al guardar la entrada de hoy y volver, el
    // volumen tiene que enterarse de la estrella nueva.
  }, [today]);

  // Doce meses hacia atrás terminando en el mes actual, para que la fila de
  // abajo sea siempre "ahora" y el año se lea como una caída de arriba abajo.
  const end = new Date(today + "T00:00");
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(end.getFullYear(), end.getMonth() - 11 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const rowOf = (iso: string) => {
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7)) - 1;
    return months.findIndex((x) => x.year === y && x.month === m);
  };

  const stars = points
    .map((p) => ({ ...p, row: rowOf(p.entry_date) }))
    .filter((p) => p.row >= 0)
    .map((p) => {
      const day = Number(p.entry_date.slice(8, 10));
      // 600 caracteres ≈ una entrada larga. Por encima ya no crece: si no,
      // un desahogo de cuatro mil se comía la fila.
      const long = p.length >= 600;
      const isToday = p.entry_date === today;
      return {
        key: p.entry_date,
        cx: X0 + ((day - 1) / 30) * (X1 - X0),
        cy: Y0 + p.row * ROW,
        r: isToday ? 3.4 : long ? 2.6 : 1.7,
        fill: isToday ? c.gilded : c.ink,
        op: isToday ? 0.95 : long ? 0.85 : 0.45,
        label: `${p.entry_date} · ${p.length} caracteres`,
      };
    });

  return (
    /* Sin tesela de estrellas, por lo mismo que la constelación: aquí una
       estrella es una entrada escrita, y el fondo estrellado del pozo añadía
       decenas de días que nadie escribió. Justo lo contrario de lo que la pieza
       existe para enseñar. */
    <Card rank="pozo" className="flex flex-col [background-image:none]">
      {/* La cadena del Diario: el volumen es lo que da nombre a la vista. */}
      <SectionBand sigil="libro" label="El volumen" count={stars.length || undefined} fill="cadena" />
      <div className="mt-3 flex items-center justify-center">
        <svg viewBox="0 0 280 300" preserveAspectRatio="xMidYMid meet"
             className="block max-h-[330px] w-full" role="img"
             aria-label={`El volumen: ${stars.length} entradas escritas en los últimos doce meses`}>
          {months.map((m, i) => (
            <g key={`${m.year}-${m.month}`}>
              <path d={`M${X0} ${Y0 + i * ROW}H${X1}`} stroke={c.axis} strokeWidth="0.8" />
              <text x={X0 - 8} y={Y0 + i * ROW + 3.5} textAnchor="end" fontFamily="Inter, sans-serif"
                    fontSize="10" fontWeight="600" letterSpacing="0.8" fill={c.tickFaint}>
                {MONTHS_ES[m.month].slice(0, 3)}
              </text>
            </g>
          ))}
          {stars.map((s) => (
            <circle key={s.key} cx={s.cx.toFixed(1)} cy={s.cy} r={s.r} fill={s.fill} fillOpacity={s.op}>
              <title>{s.label}</title>
            </circle>
          ))}
        </svg>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-2xs font-label text-[var(--text-faint)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[7px] w-[7px] rounded-full bg-[var(--text-primary)] opacity-85" />entrada larga
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[4px] w-[4px] rounded-full bg-[var(--text-primary)] opacity-45" />entrada breve
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[7px] w-[7px] rounded-full bg-[var(--gr-gilded)]" />hoy
        </span>
      </div>
      <p className="mt-2 text-2xs italic text-[var(--text-faint)] [text-wrap:pretty]">
        Una estrella por entrada, doce meses de arriba abajo y el día del mes de
        izquierda a derecha. Los huecos son los días que no escribiste: aquí el
        vacío es el dato.
      </p>
    </Card>
  );
}
