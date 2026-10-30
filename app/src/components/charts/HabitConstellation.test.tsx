import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HabitConstellation } from "./HabitConstellation";
import type { Habit } from "../../types";

/* La constelación coloca las estrellas con un hash del `id`, y un hash malo no
 * falla: sólo apila estrellas encima de otras, y el panel parece tener menos
 * hábitos de los que tiene. La primera versión lo hacía —cuatro a menos de un
 * píxel en vertical— y ninguna medición de contraste, tamaño o desborde lo
 * habría cazado. Este test es lo que lo caza.
 */

function habit(id: number, category: string, streak = 0): Habit {
  return {
    id, name: `h${id}`, category, frequency: "daily", days: null, target_per_week: 0,
    xp_reward: 10, color: "#a98bf0", active: true, notes: null, tags: null,
    created_at: "2026-01-01", streak, best_streak: streak, total_xp: 0,
    completion_rate: 0, done_today: false, last_completed: null,
  };
}

const CATS = ["Físico", "Académico", "Idioma", "Proyecto", "Personal"];
const make = (n: number, cats = 3) =>
  Array.from({ length: n }, (_, i) => habit(i + 1, CATS[i % cats]));

function stars(html: string): [number, number][] {
  return [...html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)]
    .map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
}

describe("HabitConstellation", () => {
  it("sin hábitos no dibuja lienzo", () => {
    const html = renderToStaticMarkup(<HabitConstellation habits={[]} />);
    // El sigilo de la banda también es un `<svg>`, así que la ausencia se
    // comprueba por el lienzo concreto y no por la etiqueta.
    expect(html).not.toContain('viewBox="0 0 520 310"');
    expect(stars(html)).toHaveLength(0);
    expect(html).toContain("Sin hábitos que dibujar");
  });

  it("una estrella por hábito, y ninguna fuera del lienzo", () => {
    const pts = stars(renderToStaticMarkup(<HabitConstellation habits={make(14)} />));
    expect(pts).toHaveLength(14);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(520);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(310);
    }
  });

  it("no apila estrellas: ningún par a menos de 6 px", () => {
    // El último caso es el peor: treinta hábitos en una sola categoría, todos
    // apretados en la misma celda.
    for (const [n, cats] of [[9, 3], [14, 3], [20, 5], [30, 5], [30, 1]] as const) {
      const pts = stars(renderToStaticMarkup(<HabitConstellation habits={make(n, cats)} />));
      expect(pts).toHaveLength(n);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
          expect(d, `${n} hábitos: estrellas ${i} y ${j} a ${d.toFixed(1)}px`).toBeGreaterThan(6);
        }
      }
    }
  });

  it("las posiciones no cambian entre renders", () => {
    const a = stars(renderToStaticMarkup(<HabitConstellation habits={make(14)} />));
    const b = stars(renderToStaticMarkup(<HabitConstellation habits={make(14)} />));
    expect(a).toEqual(b);
  });

  it("el tamaño no codifica nada: todas las estrellas miden igual", () => {
    // Codificar la racha en el radio daba 2,9px de diámetro a una estrella
    // pendiente y 3,1 a una cumplida: marcar un hábito movía 0,16px y parecía no
    // hacer nada. Si alguien vuelve a atar el radio a un dato, esto lo caza.
    const html = renderToStaticMarkup(
      <HabitConstellation habits={[habit(1, "Físico", 0), habit(2, "Físico", 21),
                                   habit(3, "Físico", 900)]} />,
    );
    const radii = [...html.matchAll(/ r="([\d.]+)"/g)].map((m) => m[1]);
    expect(radii).toHaveLength(3);
    expect(new Set(radii).size).toBe(1);
  });

  it("las estrellas se ven: nunca por debajo de 6px de diámetro en pantalla", () => {
    // El lienzo mide 520 y la columna donde vive, ~401px: todo se dibuja a
    // 0,772x. Un radio elegido en unidades del viewBox miente sobre su tamaño
    // real, que es exactamente por lo que las estrellas salían invisibles.
    const ESCALA = 401 / 520;
    const html = renderToStaticMarkup(<HabitConstellation habits={make(14)} />);
    const r = Number([...html.matchAll(/ r="([\d.]+)"/g)][0][1]);
    expect(2 * r * ESCALA).toBeGreaterThanOrEqual(6);
  });

  it("cada categoría lleva su nombre escrito", () => {
    // Sin rótulos había seis zigzags de colores y ninguna forma de saber cuál
    // era cuál, que es justo la pregunta que la pieza existe para contestar.
    const html = renderToStaticMarkup(<HabitConstellation habits={make(12, 4)} />);
    for (const c of CATS.slice(0, 4)) {
      expect(html).toContain(c.toUpperCase());
    }
  });

  it("una línea por categoría con más de una estrella", () => {
    const html = renderToStaticMarkup(<HabitConstellation habits={make(6, 3)} />);
    expect(html.match(/stroke-opacity="0\.28"/g)).toHaveLength(3);
    // Una categoría con un solo hábito no tiene nada que unir.
    const solo = renderToStaticMarkup(<HabitConstellation habits={make(3, 3)} />);
    expect(solo).not.toContain('stroke-opacity="0.28"');
  });
});
