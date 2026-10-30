import { toRoman } from "../../utils";
import { polar, spoke } from "../../polar";
import { Card } from "../ui/Card";
import { SectionBand } from "../ui/SectionBand";
import { chartPalette } from "../../theme-tokens";
import type { Habit } from "../../types";

/**
 * El sigilo del día: un radio por hábito, repartidos en círculo y agrupados por
 * categoría. Cumplido enciende su radio en oro; pendiente se queda en el borde.
 *
 * Es la única pieza de la vista que se lee sin leer: la rueda dice de un
 * vistazo cuánto queda y —por el sector— *qué* queda, que una barra de progreso
 * no puede decir. Por eso los sectores están desde el primer hábito y no sólo
 * cuando hay muchos.
 *
 * El oro en los radios es coherente con la ley del acento: marca lo que se
 * ganó, y aquí lo marca catorce veces al día en vez de una. Eso obligó a buscar
 * otra señal para el cierre —si el oro ya está repartido, la rueda llena y la
 * rueda cerrada se confundirían—: a día completo aparece un anillo exterior de
 * oro, el numeral sube a `gilded-bright` y el anillo interior se tiñe de
 * `gilded-deep`.
 */

const R_INNER = 52;   // arranque del radio
const R_OUTER = 86;   // punta del radio
const R_RING = 46;    // anillo interior, bajo el numeral
const R_ARC = 92;     // arcos de categoría, por fuera de las puntas
const R_SEAL = 96;    // anillo de día cerrado
const GAP = 6;        // grados de separación entre sectores de categoría

const CX = 100;
const seg = (deg: number, r0: number, r1: number) => spoke(CX, deg, r0, r1);

const arc = (from: number, to: number, r: number) => {
  const [x0, y0] = polar(CX, from, r);
  const [x1, y1] = polar(CX, to, r);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};

export function DaySigil({ habits }: { habits: Habit[] }) {
  const c = chartPalette();
  const done = habits.filter((h) => h.done_today).length;
  const closed = habits.length > 0 && done === habits.length;

  // Agrupa por categoría conservando el orden de aparición: reordenar por
  // nombre haría que crear un hábito girase la rueda entera.
  const cats: { name: string; color: string; items: Habit[] }[] = [];
  for (const h of habits) {
    const found = cats.find((c) => c.name === h.category);
    if (found) found.items.push(h);
    else cats.push({ name: h.category, color: h.color, items: [h] });
  }

  // Los sectores se reparten los 360° menos un hueco por categoría, en
  // proporción a cuántos hábitos tiene cada una.
  const free = 360 - GAP * cats.length;
  const sectors: { color: string; from: number; to: number; items: Habit[] }[] = [];
  let cursor = 0;
  for (const c of cats) {
    const span = (c.items.length / habits.length) * free;
    sectors.push({ color: c.color, from: cursor, to: cursor + span, items: c.items });
    cursor += span + GAP;
  }

  // A partir de ~20 radios el trazo de 2px se empasta; 1.4 sigue leyéndose.
  const weight = habits.length > 20 ? 1.4 : 2;

  const spokes = (wanted: boolean) =>
    sectors
      .flatMap((s) =>
        s.items
          .map((h, i) => ({ h, deg: s.from + ((i + 0.5) / s.items.length) * (s.to - s.from) }))
          .filter(({ h }) => h.done_today === wanted),
      )
      .map(({ deg }) => seg(deg, R_INNER, R_OUTER))
      .join(" ");

  return (
    <Card rank="pozo" className="flex min-h-[240px] flex-1 flex-col">
      {/* La única cadena de Hoy: el sigilo cierra la vista resumiendo el día
          entero en una figura, que es el papel de una sección principal. */}
      <SectionBand sigil="rombo" label="El sigilo del día" fill="cadena"
                   count={habits.length ? `${done}/${habits.length}` : undefined} />
      <div className="flex flex-1 flex-col items-center justify-center gap-2 pt-3">
      {habits.length === 0 ? (
        <p className="py-10 text-xs italic text-[var(--text-faint)]">
          El sigilo se dibuja con los hábitos del día.
        </p>
      ) : (
        <>
          <svg width="176" height="176" viewBox="0 0 200 200" fill="none" role="img"
               aria-label={`Sigilo del día: ${done} de ${habits.length} hábitos cumplidos`}>
            {sectors.map((s, i) => (
              <path key={i} d={arc(s.from, s.to, R_ARC)} stroke={s.color} strokeOpacity="0.5" strokeWidth="1.6" />
            ))}
            {closed && <circle cx="100" cy="100" r={R_SEAL} stroke={c.gilded} strokeWidth="1.4" />}
            <circle cx="100" cy="100" r={R_RING}
                    stroke={closed ? c.gildedDeep : c.axis} strokeWidth="1" />
            <path d={spokes(false)} stroke={c.axis} strokeWidth={weight} strokeLinecap="round" />
            <path d={spokes(true)} stroke={c.gilded} strokeWidth={weight} strokeLinecap="round" />
            {/* Cinzel a 32px: el numeral no cambia mientras se mira, así que la
                falta de cifras tabulares no lo hace bailar. */}
            <text x="100" y="112" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontSize="32"
                  fill={closed ? c.gildedBright : c.tickFaint}>
              {done === 0 ? "·" : toRoman(done)}
            </text>
          </svg>
          {closed && (
            <span className="font-label text-2xs text-[var(--gr-gilded)]">Día cerrado</span>
          )}
        </>
      )}
      </div>
    </Card>
  );
}
