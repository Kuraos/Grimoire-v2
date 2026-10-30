import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DaySigil } from "./DaySigil";
import type { Habit } from "../../types";

/* Los cuatro casos que el handoff pide verificar —0/14, 9/14, 14/14 y 30
   hábitos— más el que rompe la aritmética: cero hábitos.
 *
 * Se comprueba la geometría, no el color: los colores salen de `chartPalette()`,
 * que lee del documento y aquí devuelve cadenas vacías. Lo que puede romperse en
 * silencio es el reparto —que un sector se coma los 360°, que un radio se
 * pierda, que el anillo de cierre aparezca a 13/14— y eso sí se ve en el `d`.
 */

function habit(id: number, category: string, done: boolean): Habit {
  return {
    id, name: `h${id}`, category, frequency: "daily", days: null, target_per_week: 0,
    xp_reward: 10, color: "#a98bf0", active: true, notes: null, tags: null,
    created_at: "2026-01-01", streak: 3, best_streak: 3, total_xp: 0,
    completion_rate: 0, done_today: done, last_completed: null,
  };
}

/** `n` hábitos repartidos en tres categorías, los `done` primeros cumplidos. */
const make = (n: number, done: number) =>
  Array.from({ length: n }, (_, i) => habit(i + 1, ["Físico", "Académico", "Idioma"][i % 3], i < done));

/** Cuenta los tramos "M…L…" de un `d`: uno por radio. */
const spokes = (d: string) => (d.match(/M/g) ?? []).length;

/** Los dos `<path>` de radios son los dos últimos: pendientes y luego cumplidos. */
function radii(html: string): [number, number] {
  const ds = [...html.matchAll(/<path d="([^"]*)"[^>]*stroke-linecap="round"/g)].map((m) => m[1]);
  expect(ds).toHaveLength(2);
  return [spokes(ds[0]), spokes(ds[1])];
}

describe("DaySigil", () => {
  it("sin hábitos no dibuja rueda", () => {
    const html = renderToStaticMarkup(<DaySigil habits={[]} />);
    // El sigilo de la banda también es un `<svg>`: la ausencia se comprueba
    // por el lienzo de la rueda, no por la etiqueta.
    expect(html).not.toContain('viewBox="0 0 200 200"');
    expect(html).toContain("El sigilo se dibuja");
  });

  it("con 0/14 pinta catorce radios y ninguno en oro", () => {
    const [pending, done] = radii(renderToStaticMarkup(<DaySigil habits={make(14, 0)} />));
    expect(pending).toBe(14);
    expect(done).toBe(0);
  });

  it("con 9/14 reparte los radios entre los dos trazos", () => {
    const html = renderToStaticMarkup(<DaySigil habits={make(14, 9)} />);
    const [pending, done] = radii(html);
    expect(pending).toBe(5);
    expect(done).toBe(9);
    // Sin cerrar: nada de anillo exterior.
    expect(html).not.toContain('r="96"');
  });

  it("con 14/14 sella el día: anillo exterior y numeral romano", () => {
    const html = renderToStaticMarkup(<DaySigil habits={make(14, 14)} />);
    const [pending, done] = radii(html);
    expect(pending).toBe(0);
    expect(done).toBe(14);
    expect(html).toContain('r="96"');
    expect(html).toContain(">XIV<");
    expect(html).toContain("Día cerrado");
  });

  it("con 30 hábitos adelgaza el trazo y sigue pintando los treinta", () => {
    const html = renderToStaticMarkup(<DaySigil habits={make(30, 12)} />);
    const [pending, done] = radii(html);
    expect(pending + done).toBe(30);
    expect(done).toBe(12);
    expect(html).toContain('stroke-width="1.4"');
  });

  it("un arco por categoría, y ninguno se sale del círculo", () => {
    const html = renderToStaticMarkup(<DaySigil habits={make(14, 0)} />);
    expect(html.match(/stroke-width="1\.6"/g)).toHaveLength(3);
    // Todo punto dibujado cae dentro del lienzo de 200×200.
    for (const [, n] of html.matchAll(/[ML](-?\d+\.?\d*) (-?\d+\.?\d*)/g)) {
      expect(Number(n)).toBeGreaterThanOrEqual(0);
      expect(Number(n)).toBeLessThanOrEqual(200);
    }
  });
});
