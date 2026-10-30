import { ReactNode } from "react";
import { Sigil, SigilName } from "./Sigil";

/**
 * La banda de sección: la fila que abre cada bloque de contenido.
 *
 *   ┌──────┬─────────────────────────────────────────────┐
 *   │ ◇    │ RÓTULO  cuenta  ─────────────────────────  ◆ │
 *   │ ◆    ├─────────────────────────────────────────────┤
 *   │ │    │ contenido, sangrado a la columna del sigilo  │
 *
 * La columna de 28px lleva el sigilo que identifica la sección; debajo, un
 * rombo y una espina vertical que ata el bloque entero. A la derecha del
 * rótulo, un relleno que corre hasta el borde y un rombo de remate: el filete
 * termina en algo en vez de cortarse contra el margen.
 *
 * Tres rellenos, y no son intercambiables:
 *   cadena    la de eslabones. Una por vista, la de la sección principal.
 *   filete    línea punteada. El separador de todos los días.
 *   linea     regla continua de 1px. Para bandas anidadas, que ya cuelgan de
 *             una espina y no necesitan más textura.
 *   arcana    la regla teñida de arcano. Sólo donde el sistema espera que
 *             escribas — la reflexión de la reseña, y nada más.
 */
export function SectionBand({
  sigil, versal, label, count, right, fill = "filete", spine = false, tone, children,
}: {
  /** Marca de la columna izquierda. */
  sigil?: SigilName;
  /** Alternativa al sigilo: la inicial del rótulo en Cinzel, como una versal. */
  versal?: string;
  label: string;
  /** Cifra que acompaña al rótulo, en tinta tenue tabular. */
  count?: ReactNode;
  /** Contenido extra al final de la fila, antes del rombo de remate. */
  right?: ReactNode;
  fill?: "cadena" | "filete" | "linea" | "arcana";
  /** Espina vertical que baja por la columna y ata el bloque. */
  spine?: boolean;
  /** Color del sigilo y del rótulo. Por defecto, tinta. */
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`grid grid-cols-[28px_1fr] gap-x-2 ${spine ? "border-l border-[var(--gr-edge)] pl-1" : ""}`}>
      <div className="row-span-2 flex flex-col items-center gap-[7px]" style={tone ? { color: tone } : undefined}>
        {versal ? (
          <span className="font-display text-xl font-semibold normal-case tracking-normal text-[var(--text-muted)]">
            {versal}
          </span>
        ) : sigil ? (
          <span className={tone ? "" : "text-[var(--text-muted)]"}><Sigil name={sigil} /></span>
        ) : null}
        <span className="h-[5px] w-[5px] rotate-45 bg-[var(--border-strong)]" />
        {spine && <span className="w-px flex-1 bg-[var(--gr-edge)]" />}
      </div>

      <div className="flex items-center gap-2 pt-1 font-label text-xs tracking-[0.1em]">
        <span style={tone ? { color: tone } : { color: "var(--text-muted)" }}>{label}</span>
        {count != null && <span className="tabular text-[var(--text-faint)]">{count}</span>}
        <span className={FILL[fill]} />
        {right}
        <span className="h-[5px] w-[5px] shrink-0 rotate-45 bg-[var(--text-faint)] opacity-50" />
      </div>

      {children && <div className="mt-2">{children}</div>}
    </section>
  );
}

const FILL = {
  cadena: "gr-cadena",
  filete: "gr-filete",
  linea: "h-px flex-1 bg-[var(--gr-edge)]",
  arcana: "h-px flex-1 bg-[var(--gr-edge-arcane)]",
} as const;
