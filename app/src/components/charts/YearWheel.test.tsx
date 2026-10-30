import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { YearWheel, isoWeek } from "./YearWheel";

/* La semana ISO es terreno de errores por uno: el año no empieza en la semana 1
 * si el 1 de enero cae jueves o más tarde, y el 31 de diciembre puede
 * pertenecer a la semana 1 del año siguiente. Un desfase de una semana no
 * rompería nada — sólo encendería el radio de al lado, y nadie lo notaría.
 */

describe("isoWeek", () => {
  it("clava los bordes de año que definen la norma", () => {
    // 2026 empieza en jueves: el 1 de enero ya es semana 1.
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    // 2021 empezó en viernes: el 1 de enero pertenece a la semana 53 de 2020.
    expect(isoWeek(new Date(2021, 0, 1))).toBe(53);
    // 2024 empezó en lunes: semana 1 limpia.
    expect(isoWeek(new Date(2024, 0, 1))).toBe(1);
    // El 31 de diciembre de 2019 (martes) cae ya en la semana 1 de 2020.
    expect(isoWeek(new Date(2019, 11, 31))).toBe(1);
  });

  it("los siete días de una semana comparten número", () => {
    const lunes = new Date(2026, 7, 10);
    const nums = Array.from({ length: 7 }, (_, i) =>
      isoWeek(new Date(lunes.getTime() + i * 864e5)),
    );
    expect(new Set(nums).size).toBe(1);
    // …y el lunes siguiente ya es la próxima.
    expect(isoWeek(new Date(lunes.getTime() + 7 * 864e5))).toBe(nums[0] + 1);
  });
});

/** [futuras, en blanco, reseñadas, la actual] */
function spokes(html: string): number[] {
  return [...html.matchAll(/<path d="([^"]*)"/g)].map((m) => (m[1].match(/M/g) ?? []).length);
}

describe("YearWheel", () => {
  it("reparte los 52 radios entre los cuatro estados, sin perder ninguno", () => {
    const hechas = new Set([1, 2, 3, 10, 20]);
    const html = renderToStaticMarkup(<YearWheel weeks={hechas} current={33} />);
    const [futuro, blanco, oro, actual] = spokes(html);
    expect(oro).toBe(5);
    expect(actual).toBe(1);
    // 32 semanas transcurridas menos las 5 reseñadas.
    expect(blanco).toBe(27);
    expect(futuro).toBe(52 - 33);
    expect(futuro + blanco + oro + actual).toBe(52);
  });

  it("en la semana 1 no hay nada en blanco todavía", () => {
    const html = renderToStaticMarkup(<YearWheel weeks={new Set()} current={1} />);
    const [futuro, blanco, oro, actual] = spokes(html);
    expect(blanco).toBe(0);
    expect(oro).toBe(0);
    expect(actual).toBe(1);
    expect(futuro).toBe(51);
    expect(html).toContain("En blanco · 0");
  });

  it("el numeral del centro va en romanos", () => {
    const html = renderToStaticMarkup(<YearWheel weeks={new Set()} current={33} />);
    expect(html).toContain(">XXXIII<");
    expect(html).toContain(">SEMANA<");
  });

  it("ningún radio se sale del lienzo de 320", () => {
    const html = renderToStaticMarkup(<YearWheel weeks={new Set([7])} current={40} />);
    for (const [, x, y] of html.matchAll(/[ML](-?\d+\.?\d*) (-?\d+\.?\d*)/g)) {
      for (const n of [Number(x), Number(y)]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(320);
      }
    }
  });
});
