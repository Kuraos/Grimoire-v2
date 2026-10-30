import { toRoman } from "../../utils";
import { chartPalette } from "../../theme-tokens";
import { spoke } from "../../polar";

/**
 * La rueda del año: cincuenta y dos radios, uno por semana ISO.
 *
 * El historial de la derecha lista las últimas reseñas en orden, y eso dice qué
 * escribiste pero no **cuánto has sostenido el rito**. La rueda sí: de un
 * vistazo se ve el arco de semanas seguidas en oro y el hueco donde se dejó
 * caer, que es la única pregunta que una revisión semanal necesita contestar
 * sobre sí misma.
 *
 * El oro se gana al guardar la reseña, así que aquí es legítimo: cada radio
 * dorado es un rito cumplido, igual que un hábito marcado. Lo que pasó en
 * blanco se queda en tinta —no en rojo—: no anotar no se castiga, se ve.
 *
 * Las semanas que aún no han llegado se dibujan al mínimo en vez de omitirse.
 * Sin ellas la rueda quedaba abierta por un lado y parecía rota; con ellas, el
 * año es un círculo completo del que llevas una parte.
 */

const CX = 160;
const R_IN = 104;
const R_OUT = 140;
const WEEKS = 52;

/** Semana ISO de una fecha, 1..53. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // El jueves de la misma semana decide el año ISO al que pertenece.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const enero1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - enero1.getTime()) / 86400000 + 1) / 7);
}

const radio = (i: number, r0: number, r1: number) => spoke(CX, (i * 360) / WEEKS, r0, r1);

export function YearWheel({ weeks, current }: {
  /** Semanas ISO con reseña guardada, como número (1..53). */
  weeks: Set<number>;
  /** Semana en curso. */
  current: number;
}) {
  const c = chartPalette();

  const hechas: string[] = [];
  const blanco: string[] = [];
  const futuro: string[] = [];

  for (let i = 1; i <= WEEKS; i++) {
    if (i === current) continue;
    const d = radio(i - 1, R_IN, R_OUT);
    if (weeks.has(i)) hechas.push(d);
    else if (i < current) blanco.push(d);
    else futuro.push(d);
  }

  return (
    <div>
      <div className="flex justify-center">
        <svg viewBox="0 0 320 320" className="block w-full max-w-[300px]" fill="none" role="img"
             aria-label={`Rueda del año: ${weeks.size} semanas reseñadas de ${current - 1} transcurridas`}>
          <path d={futuro.join(" ")} stroke={c.axis} strokeOpacity="0.4" strokeWidth="1.4" strokeLinecap="round" />
          <path d={blanco.join(" ")} stroke={c.axis} strokeWidth="2.4" strokeLinecap="round" />
          <path d={hechas.join(" ")} stroke={c.gilded} strokeWidth="2.4" strokeLinecap="round" />
          {/* La semana en curso sobresale por los dos extremos: es la única que
              todavía se puede cambiar. */}
          <path d={radio(current - 1, R_IN - 8, R_OUT + 8)} stroke={c.arcane}
                strokeWidth="2.8" strokeLinecap="round" />

          <text x={CX} y={CX + 4} textAnchor="middle" fontFamily="Cinzel, Georgia, serif"
                fontSize="42" fontWeight="600" fill={c.ink}>
            {toRoman(current)}
          </text>
          <text x={CX} y={CX + 26} textAnchor="middle" fontFamily="Inter, sans-serif"
                fontSize="11" fontWeight="600" letterSpacing="2" fill={c.tickFaint}>
            SEMANA
          </text>
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-label text-2xs text-[var(--text-faint)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[var(--gr-gilded)]" />
          Reseñada · {weeks.size}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[var(--gr-edge)]" />
          En blanco · {Math.max(0, current - 1 - weeks.size)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[var(--gr-arcane)]" />
          Esta semana
        </span>
      </div>
      <p className="mt-2 text-2xs italic text-[var(--text-faint)] [text-wrap:pretty]">
        Cincuenta y dos radios, uno por semana ISO. El oro se gana al guardar la
        reseña, así que la rueda dice de un vistazo cuánto has sostenido el rito
        — y dónde lo dejaste caer.
      </p>
    </div>
  );
}
