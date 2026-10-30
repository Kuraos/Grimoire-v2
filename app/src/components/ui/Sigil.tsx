/**
 * Los sigilos: marcas geométricas de 12×12 que identifican una sección.
 *
 * Sustituyen al calderón genérico que ocupaba ese hueco. La diferencia es que
 * un calderón sólo dice «aquí empieza algo» y un sigilo dice *qué* empieza: el
 * triángulo es Físico, el creciente es Idioma, el cuadrado con marca es la
 * columna de hechas. Ornamento que además identifica.
 *
 * Van siempre en tinta, nunca en el color de la categoría: ese trabajo ya lo
 * hace el filete de color de la tarjeta, y repetirlo aquí gastaría dos señales
 * en decir lo mismo. La excepción es Logros, donde el sigilo es el color de la
 * rareza porque ahí la rareza es el dato.
 *
 * Trazo 0.8 sobre lienzo de 12 y render a 22px: a ese grosor la marca lee como
 * grabado, no como icono de interfaz.
 */

const SIGILOS = {
  /* Categorías de hábitos */
  disco: ["M6 1a5 5 0 1 0 0 10a5 5 0 1 0 0 -10", "M6 5.4a.6 .6 0 1 0 0 1.2a.6 .6 0 1 0 0 -1.2"],
  triangulo: ["M6 1L11 10.5H1Z", ""],
  creciente: ["M8.6 1a5 5 0 1 0 0 10A6.4 6.4 0 0 1 8.6 1", ""],
  rombo: ["M6 1L11 6L6 11L1 6Z", "M6 5.4a.6 .6 0 1 0 0 1.2a.6 .6 0 1 0 0 -1.2"],
  hexagono: ["M6 1L10.3 3.5V8.5L6 11L1.7 8.5V3.5Z", ""],

  /* Rarezas de logro: cuanto más raro, más anidado */
  hexagonoAnidado: ["M6 1L10.3 3.5V8.5L6 11L1.7 8.5V3.5Z", "M6 4.2L7.8 6L6 7.8L4.2 6Z"],
  romboAnidado: ["M6 1L11 6L6 11L1 6Z", "M6 4.4L7.6 6L6 7.6L4.4 6Z"],
  romboLlano: ["M6 1L11 6L6 11L1 6Z", ""],
  circulo: ["M6 1a5 5 0 1 0 0 10a5 5 0 1 0 0 -10", ""],

  /* Columnas del tablero */
  caja: ["M2 2h8v8H2Z", ""],
  cajaMedia: ["M2 2h8v8H2Z", "M2 6h8"],
  cajaMarcada: ["M2 2h8v8H2Z", "M3.6 6.2L5.3 8L8.4 4.4"],

  /* Secciones con nombre propio */
  reloj: ["M6 1a5 5 0 1 0 0 10a5 5 0 1 0 0 -10", "M6 3.5V6l1.8 1.2"],
  libro: ["M2 2.6h8v7.4a.9 .9 0 0 1 -.9 .9h-6.2a.9 .9 0 0 1 -.9 -.9Z", "M2 5.4h8"],
  discoDoble: ["M6 1.2A5.4 5.4 0 0 1 6 10.8A5.4 5.4 0 0 1 6 1.2", "M6 1.2A5.4 5.4 0 0 0 6 10.8"],
  diamante: ["M6 1L11 6L6 11L1 6Z", "M6 4.4L7.6 6L6 7.6L4.4 6Z"],
} as const;

export type SigilName = keyof typeof SIGILOS;

/** Categorías del catálogo → su marca. Lo que no esté en el mapa cae al rombo. */
const POR_CATEGORIA: Record<string, SigilName> = {
  "Académico": "disco",
  "Físico": "triangulo",
  "Idioma": "creciente",
  "Mente": "rombo",
  "Proyecto": "hexagono",
  "Personal": "circulo",
  "Trabajo": "caja",
  "TCG": "hexagono",
  "Otro": "romboLlano",
};

export const sigilDeCategoria = (cat: string): SigilName => POR_CATEGORIA[cat] ?? "rombo";

export function Sigil({ name, size = 22 }: { name: SigilName; size?: number }) {
  const [d1, d2] = SIGILOS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor"
         strokeWidth="0.8" strokeLinejoin="round" aria-hidden>
      <path d={d1} />
      {d2 && <path d={d2} />}
    </svg>
  );
}
