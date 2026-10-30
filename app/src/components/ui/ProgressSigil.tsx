import { spoke } from "../../polar";

/**
 * El sigilo de progreso: la misma rueda del temporizador, en miniatura.
 *
 * Una barra de porcentaje dice la fracción y nada más. La rueda dice además
 * *cuántas* piezas hay —las marcas se cuentan— y eso es lo que se quiere saber
 * de un proyecto: no «va por el 58%» sino «quedan cinco».
 *
 * Comparte geometría con el dial del Pomodoro a propósito: en Grimoire una
 * rueda de marcas significa siempre lo mismo, algo que avanza por pasos
 * contables. Cambia el tamaño, no el idioma.
 *
 * Lo hecho va en oro y no en arcano, al revés que el Pomodoro: allí las marcas
 * son minutos que pasan —estado— y aquí son tareas cerradas, que se ganan.
 */
const C = 24;
const R_IN = 13;
const R_OUT = 19;

export function ProgressSigil({ done, total }: { done: number; total: number }) {
  // Por encima de veinte pasos las marcas se empastan; se agrupan de cinco en
  // cinco para que la rueda siga contándose en vez de convertirse en un anillo.
  const step = total > 20 ? 5 : 1;
  const marks = Math.max(1, Math.ceil(total / step));
  const filled = Math.round(done / step);

  const pending: string[] = [];
  const doneMarks: string[] = [];
  for (let i = 0; i < marks; i++) {
    (i < filled ? doneMarks : pending).push(spoke(C, (i * 360) / marks, R_IN, R_OUT));
  }

  const complete = total > 0 && done >= total;

  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" role="img"
         aria-label={`${done} de ${total}`}>
      {/* El anillo exterior sólo se cierra en oro cuando está todo hecho: es la
          diferencia entre la rueda llena y la rueda cerrada. */}
      <circle cx={C} cy={C} r={22} strokeWidth={complete ? 1.2 : 1}
              stroke={complete ? "var(--gr-gilded)" : "var(--gr-edge)"} />
      <path d={pending.join(" ")} stroke="var(--gr-edge)" strokeWidth="1.6" strokeLinecap="round" />
      <path d={doneMarks.join(" ")} stroke="var(--gr-gilded)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
