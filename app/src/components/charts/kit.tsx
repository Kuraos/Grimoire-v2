import type { ReactNode } from "react";
import { curveMonotoneX } from "@visx/curve";
import { useChart } from "../bklit";

/**
 * Lo que comparten los gráficos de Grimoire montados sobre Bklit.
 *
 * Bklit es de series temporales: su eje X es un `Date`. El backend manda días
 * como "2026-10-20", y `new Date("2026-10-20")` los lee en UTC: en Bogotá
 * (UTC−5) eso es el 19 a las 19:00, y cada punto caería en el día anterior.
 * Se construyen en hora local.
 */
export function isoDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Bklit dibuja con `curveNatural`, que entre pocos puntos se pasa de largo e
 *  inventa picos que el dato no tiene. Monótona: lo que hacía recharts. */
export const CURVE = curveMonotoneX;

/** Altura fija en vez de la proporción 2:1 de Bklit: en un pozo estrecho la
 *  proporción daba gráficos de 120 px de alto, y en uno ancho de 500. */
export function fixedHeight(px: number) {
  return { aspectRatio: "", style: { height: px } } as const;
}

/** Márgenes de la casa. Bklit trae 40 por lado; los laterales sobran en una
 *  card, pero el de abajo no: las fechas del eje van a `bottom: 12` del
 *  contenedor, y con menos de 40 se montan sobre el «0» del eje Y. */
export const MARGIN = { top: 12, right: 12, bottom: 40, left: 40 };

export function ChartEmpty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-xs text-[var(--text-muted)]">{children}</div>;
}

export type LegendItem = { label: string; color: string; shape?: "line" | "dash" | "square" | "rhombus" | "ring" };

/** Leyenda bajo el gráfico, con la muestra dibujada como en la serie. Recharts
 *  traía la suya; Bklit no, y cada gráfico tenía ya una versión a mano. */
export function ChartLegend({ items, note, inset = 40 }: { items: LegendItem[]; note?: string; inset?: number }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-[var(--text-muted)]" style={{ paddingLeft: inset }}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <Swatch color={it.color} shape={it.shape ?? "square"} />
          {it.label}
        </span>
      ))}
      {note && <span className="ml-auto italic text-[var(--text-faint)]">{note}</span>}
    </div>
  );
}

function Swatch({ color, shape }: { color: string; shape: NonNullable<LegendItem["shape"]> }) {
  switch (shape) {
    case "line":
      return <span className="h-[2px] w-4" style={{ background: color }} />;
    case "dash":
      return <span className="w-4 border-t-[1.5px] border-dashed" style={{ borderColor: color }} />;
    case "rhombus":
      return <span className="h-[7px] w-[7px] rotate-45" style={{ background: color }} />;
    case "ring":
      return <span className="h-2 w-2 rounded-full border-[1.5px]" style={{ borderColor: color }} />;
    default:
      return <span className="h-[9px] w-[9px] rounded-xs" style={{ background: color }} />;
  }
}

/**
 * Marcas sobre puntos concretos de una serie: el rombo del récord, el anillo
 * ámbar de una estimación floja. Bklit marca todos los puntos de una serie o
 * ninguno, y con forma de círculo; esto lee las escalas del contexto del
 * gráfico y dibuja sólo donde `when` lo pide.
 */
export function PointMarks({ dataKey, when = () => true, shape, color, yAxisId = "left" }: {
  dataKey: string;
  when?: (d: Record<string, unknown>) => boolean;
  shape: "dot" | "rhombus" | "ring";
  color: string;
  yAxisId?: string;
}) {
  const { data, xScale, yScales, xAccessor } = useChart();
  const y = yScales[yAxisId];
  if (!y) return null;
  return (
    <g pointerEvents="none">
      {data.map((d, i) => {
        const v = d[dataKey];
        if (typeof v !== "number" || !when(d)) return null;
        const cx = xScale(xAccessor(d));
        const cy = y(v);
        if (shape === "rhombus") {
          return <rect key={i} x={cx - 3.6} y={cy - 3.6} width={7.2} height={7.2} fill={color} transform={`rotate(45 ${cx} ${cy})`} />;
        }
        if (shape === "ring") {
          return <circle key={i} cx={cx} cy={cy} r={3.5} fill="var(--gr-surface-sunken)" stroke={color} strokeWidth={1.5} />;
        }
        return <circle key={i} cx={cx} cy={cy} r={2} fill={color} />;
      })}
    </g>
  );
}
