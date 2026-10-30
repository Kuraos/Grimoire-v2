/**
 * Puente entre theme.css y el JS que no puede usar `var()`.
 *
 * Los atributos de presentación de SVG —`stroke` y `fill` de las piezas de
 * ornamento dibujadas a mano— no sustituyen custom properties: necesitan un
 * color ya resuelto. (Los gráficos de Bklit no pasan por aquí: pintan con
 * `var(--chart-*)` en `style`, y eso sí lo resuelve el navegador.) Duplicar la paleta a mano es justo como los gráficos
 * acabaron pintando el morado de la config antigua (#9b7fc4) mientras el tema
 * decía otra cosa. Aquí la leemos del documento, así theme.css sigue siendo la
 * única fuente de verdad también fuera del CSS.
 *
 * Para objetos de estilo de React no hace falta nada de esto: ahí `var(--gr-*)`
 * funciona directamente.
 */

export type ChartPalette = {
  axis: string;
  tickFaint: string;
  ink: string;
  arcane: string;
  surfaceRaised: string;
  /* Las tres piezas de ornamento —sigilo, constelación, volumen— son SVG
     escrito a mano, y sus `stroke`/`fill` son atributos de presentación
     y tampoco sustituyen `var()`. */
  gilded: string;
  gildedBright: string;
  gildedDeep: string;
};

let cache: ChartPalette | null = null;

function read(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Se resuelve durante el primer render —ya con el CSS aplicado— y se memoiza.
 * La paleta no cambia en caliente: Grimoire no tiene selector de tema.
 */
export function chartPalette(): ChartPalette {
  if (cache) return cache;
  cache = {
    axis: read("--gr-edge"),
    tickFaint: read("--gr-ink-faint"),
    ink: read("--gr-ink-bright"),
    arcane: read("--gr-arcane"),
    surfaceRaised: read("--gr-surface-raised"),
    gilded: read("--gr-gilded"),
    gildedBright: read("--gr-gilded-bright"),
    gildedDeep: read("--gr-gilded-deep"),
  };
  return cache;
}

/**
 * Rótulo (11px): el peldaño de etiqueta de la escala, para el texto SVG de la
 * constelación, que recibe un número y no una clase.
 */
export const CHART_LABEL_SIZE = 11;

/**
 * Tiempos y curvas de Motion, leídos de theme.css.
 *
 * Motion quiere segundos y la curva como cuatro números; `var(--gr-dur-enter)`
 * no le sirve. Copiar 0.24 aquí sería una segunda fuente de verdad del ritmo de
 * la app, así que se lee igual que la paleta de los gráficos.
 */
export type MotionTokens = {
  state: number;
  enter: number;
  reward: number;
  easeOut: [number, number, number, number];
  easeReward: [number, number, number, number];
};

let motionCache: MotionTokens | null = null;

/** `"240ms"` → 0.24; `"0.3s"` → 0.3. */
export function toSeconds(css: string): number {
  const n = parseFloat(css);
  return css.trim().endsWith("ms") ? n / 1000 : n;
}

/** `"cubic-bezier(0.22, 1, 0.36, 1)"` → `[0.22, 1, 0.36, 1]`. */
export function toBezier(css: string): [number, number, number, number] {
  const m = css.match(/cubic-bezier\(([^)]+)\)/);
  const n = m ? m[1].split(",").map(Number) : [];
  return n.length === 4 && n.every(Number.isFinite)
    ? (n as [number, number, number, number])
    : [0.22, 1, 0.36, 1];
}

export function motionTokens(): MotionTokens {
  if (motionCache) return motionCache;
  motionCache = {
    state: toSeconds(read("--gr-dur-state") || "170ms"),
    enter: toSeconds(read("--gr-dur-enter") || "240ms"),
    reward: toSeconds(read("--gr-dur-reward") || "420ms"),
    easeOut: toBezier(read("--gr-ease-out")),
    easeReward: toBezier(read("--gr-ease-reward")),
  };
  return motionCache;
}

/** `#rrggbb` → `[r, g, b]`. Para interpolar entre dos tokens. */
export function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
