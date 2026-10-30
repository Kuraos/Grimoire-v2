/**
 * Cifra del peldaño de 34px con su rótulo debajo. Sin caja.
 *
 * Estadísticas y Hábitos tenían cada una la suya, idénticas salvo por el sufijo
 * opcional del porcentaje. El `%` va a 24px y no a 34: al mismo tamaño pesaba
 * como el número y la cifra dejaba de leerse de un golpe.
 *
 * El Erario tenía además una TERCERA, local, con otra API (`muted`/`tone`) y
 * otro rótulo: dos formas distintas del mismo rol `.gr-figure` conviviendo en la
 * misma app. Aquí están las dos, y el rótulo es uno solo.
 *
 * `gold` sólo para lo que se gana. Lo demás es dato, y va en tinta — que es la
 * razón de que el erario tenga `tone`: un saldo pasado de cerco es estado
 * semántico, no recompensa, y el oro no entra ahí.
 *
 * Un `value` numérico rueda sus dígitos al cambiar (NumberFlow); uno de texto
 * —«12 · 80 %», «45m», un monto ya formateado— se pinta tal cual. Rodar no es
 * celebrar: es la misma tinta, sólo que el cambio se ve llegar.
 */
import NumberFlow from "@number-flow/react";

export function Figure({ value, label, suffix, gold, muted, tone }: {
  value: string | number;
  label: string;
  suffix?: string;
  /** lo que el usuario se ganó */
  gold?: boolean;
  /** cifra de contexto: baja de tinta brillante a tinta de cuerpo */
  muted?: boolean;
  /** estado semántico; hoy sólo el rojo del cerco pasado */
  tone?: "danger";
}) {
  const color =
    gold ? "var(--gr-gilded)"
    : tone === "danger" ? "var(--danger)"
    : muted ? "var(--text-body)"
    : "var(--gr-ink-bright)";

  return (
    <div>
      <div className="gr-figure" style={{ color }}>
        {typeof value === "number" ? <NumberFlow value={value} locales="es" /> : value}
        {suffix && <span className="text-xl text-[var(--text-faint)]">{suffix}</span>}
      </div>
      <div className="mt-1.5 text-2xs font-label text-[var(--text-muted)]">{label}</div>
    </div>
  );
}
