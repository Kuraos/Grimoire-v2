import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PomodoroTimer } from "./PomodoroTimer";

/* La esfera reparte una marca por minuto entre dos trazos —lo corrido en arcano,
 * lo que queda en tinta— y añade un filete cada cinco. Si el reparto se desplaza
 * un minuto no falla nada: el reloj simplemente miente, y miente poco, que es la
 * clase de error que nadie ve hasta que ya lleva semanas.
 */

const props = {
  phase: "work" as const,
  running: false,
  onStart: () => {},
  onPause: () => {},
};

/** [marcas pendientes, marcas corridas, filetes de cuarto]
 *
 *  Acotado al `<svg>` de la esfera: los iconos de los botones también son
 *  `<path>`, y contarlos daba seis trazos donde hay tres. */
function dial(html: string): [number, number, number] {
  const svg = html.match(/<svg[^>]*viewBox="0 0 320 320"[\s\S]*?<\/svg>/)?.[0] ?? "";
  const ds = [...svg.matchAll(/<path d="([^"]*)"/g)].map((m) => (m[1].match(/M/g) ?? []).length);
  expect(ds).toHaveLength(3);
  return ds as [number, number, number];
}

describe("PomodoroTimer · la esfera", () => {
  it("una marca por minuto de la fase, y una de cuarto cada cinco", () => {
    const html = renderToStaticMarkup(
      <PomodoroTimer {...props} secondsLeft={25 * 60} totalSeconds={25 * 60} progress={0} />,
    );
    const [pending, elapsed, quarters] = dial(html);
    expect(pending).toBe(25);
    expect(elapsed).toBe(0);
    expect(quarters).toBe(5);
  });

  it("a mitad de fase reparte las marcas entre los dos trazos", () => {
    const html = renderToStaticMarkup(
      <PomodoroTimer {...props} secondsLeft={12 * 60} totalSeconds={25 * 60} progress={0.52} />,
    );
    const [pending, elapsed] = dial(html);
    expect(elapsed).toBe(13);
    expect(pending + elapsed).toBe(25);
  });

  it("al llegar a cero la esfera queda llena, sin marcas sueltas", () => {
    const html = renderToStaticMarkup(
      <PomodoroTimer {...props} secondsLeft={0} totalSeconds={25 * 60} progress={1} />,
    );
    const [pending, elapsed] = dial(html);
    expect(pending).toBe(0);
    expect(elapsed).toBe(25);
  });

  it("una fase corta tiene su propio número de marcas", () => {
    const html = renderToStaticMarkup(
      <PomodoroTimer {...props} phase="short" secondsLeft={5 * 60} totalSeconds={5 * 60} progress={0} />,
    );
    const [pending, , quarters] = dial(html);
    expect(pending).toBe(5);
    expect(quarters).toBe(1);
  });

  it("en card no dibuja esfera: 320px no caben junto a una lista", () => {
    const html = renderToStaticMarkup(
      <PomodoroTimer {...props} secondsLeft={60} totalSeconds={25 * 60} progress={0.9} big={false} />,
    );
    expect(html).not.toContain('viewBox="0 0 320 320"');
    expect(html).toContain("01:00");
  });
});
