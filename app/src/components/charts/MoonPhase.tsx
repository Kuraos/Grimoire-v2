/**
 * La luna: fase por mes sinódico medio.
 *
 * Es la única pieza de Grimoire que no habla del usuario. Está aquí porque un
 * calendario gótico sin luna es un calendario de oficina con otra tipografía, y
 * porque el dato que da —cuánta luz habrá esta noche— es el que hace falta para
 * decidir si sale a observar.
 *
 * Media sinódica, no efemérides: el error es de horas sobre un ciclo de 29 días
 * y medio, invisible en una figura de 132px, y evita traerse una tabla
 * astronómica a una app que se instala en local.
 */

const SYN = 29.530588853;
/** Luna nueva de referencia: 6 de enero de 2000, 18:14 UTC. */
const REF = Date.UTC(2000, 0, 6, 18, 14) / 86400000;

/** Fase en [0,1): 0 = nueva, 0.5 = llena. */
export function moonPhase(d: Date): number {
  const t = (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) / 86400000 - REF) / SYN;
  return t - Math.floor(t);
}

/** Fracción iluminada del disco, de 0 a 1. */
export const moonIllum = (ph: number) => (1 - Math.cos(2 * Math.PI * ph)) / 2;

/**
 * La región iluminada: medio limbo exterior más la elipse del terminador.
 *
 * El radio horizontal de la elipse es `r·|1−2k|`, que llega a cero en el cuarto
 * —donde el terminador se ve de canto y es una recta— y crece hasta `r` en la
 * nueva y en la llena. Los dos flags de barrido son lo que decide si la panza
 * mira a un lado o al otro: sin ellos, la menguante se dibujaba igual que la
 * creciente y la figura mentía media lunación de cada una.
 */
export function moonPath(ph: number, r: number): string {
  const k = moonIllum(ph);
  const rx = Math.round(r * Math.abs(1 - 2 * k) * 100) / 100;
  const waxing = ph < 0.5;
  const outer = waxing ? 1 : 0;
  const inner = k < 0.5 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);
  return `M0 ${-r}A${r} ${r} 0 0 ${outer} 0 ${r}A${rx} ${r} 0 0 ${inner} 0 ${-r}`;
}

export function moonName(ph: number): string {
  const e = 0.02;
  if (ph < e || ph > 1 - e) return "Luna nueva";
  if (Math.abs(ph - 0.25) < e) return "Cuarto creciente";
  if (Math.abs(ph - 0.5) < e) return "Luna llena";
  if (Math.abs(ph - 0.75) < e) return "Cuarto menguante";
  if (ph < 0.25) return "Creciente";
  if (ph < 0.5) return "Gibosa creciente";
  if (ph < 0.75) return "Gibosa menguante";
  return "Menguante";
}

/** Disco pequeño para las celdas del mes y la tira de la lunación. */
export function MoonDisc({ date, opacity = 1 }: { date: Date; opacity?: number }) {
  const r = 7.6;
  const ph = moonPhase(date);
  return (
    <svg width="30" height="30" viewBox="-9 -9 18 18" fill="none" aria-hidden>
      <circle cx="0" cy="0" r={r} stroke="var(--gr-edge)" strokeWidth="0.8" />
      <path d={moonPath(ph, r * 0.86)} fill="var(--gr-ink-faint)" fillOpacity={opacity} />
    </svg>
  );
}
