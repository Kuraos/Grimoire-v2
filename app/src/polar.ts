/**
 * Geometría polar de las ruedas.
 *
 * Grimoire dibuja cuatro: el dial del Pomodoro, el sigilo del día, el sigilo de
 * progreso de un proyecto y la rueda del año. Las cuatro son lo mismo —marcas
 * repartidas en círculo desde arriba— y las cuatro tenían su propia copia de
 * estas seis líneas, cada una con su forma de redondear.
 *
 * Cero grados arriba y giro horario, que es como se leen un reloj y un
 * calendario. El redondeo a un decimal mantiene los `d` cortos sin que se note
 * el escalón: a los radios de estas piezas, 0,1 unidades es menos de un píxel.
 */

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Punto de la circunferencia de centro `cx` a `deg` grados y radio `r`. */
export function polar(cx: number, deg: number, r: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cx + r * Math.sin(a)];
}

/** Marca radial: el segmento de `r0` a `r1` sobre el ángulo `deg`. */
export function spoke(cx: number, deg: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, deg, from);
  const [x1, y1] = polar(cx, deg, to);
  return `M${r1(x0)} ${r1(y0)}L${r1(x1)} ${r1(y1)}`;
}

/**
 * Orla de puntas: dos triángulos por punta, hacia dentro y hacia fuera.
 * Es la tracería de los medallones de logro — la de la tarjeta y la del panel
 * «el más cercano» son la misma figura a dos tamaños y dos recuentos.
 */
export function tracery(cx: number, r0: number, r: number, points: number): string {
  const seg: string[] = [];
  const p = (k: number, rad: number) => {
    const [x, y] = polar(cx, (k * 360) / points, rad);
    return `${r1(x)} ${r1(y)}`;
  };
  for (let i = 0; i < points; i++) {
    seg.push(`M${p(i, r0)}L${p(i + 0.5, r)}L${p(i + 1, r0)}`);
  }
  return seg.join(" ");
}
