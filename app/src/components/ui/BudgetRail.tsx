import { formatMoney, budgetState } from "../../utils";

/**
 * El carril de una asignación: cuánto se lleva gastado contra el cerco del mes.
 *
 * NO usa el degradado de XP (`--gr-xp-from → --gr-xp-to`). Ese va de arcano a
 * dorado porque representa avance hacia una recompensa, y aquí un carril lleno
 * significa lo contrario —te lo gastaste todo—, así que terminaría premiando en
 * oro justo el peor mes. Es literalmente el bug del Pomodoro con otra ropa.
 *
 * El color lo pone el estado, con los semánticos que ya existen y ya tienen sus
 * contrastes verificados. Y el estado se lee también sin color: el número de la
 * derecha dice lo mismo, porque un carril rojo y uno verde a 7px de alto son la
 * misma forma para quien no distingue los dos tonos.
 */

const FILL: Record<string, string> = {
  ok: "var(--gr-verdigris)",
  warn: "var(--gr-amber)",
  over: "var(--gr-oxblood)",
};

export function BudgetRail({ name, color, spent, budget, currency }: {
  name: string;
  color: string;
  spent: number;
  budget: number;
  currency: string;
}) {
  const state = budgetState(spent, budget);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const left = budget - spent;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-[var(--text-body)]">
          <span className="inline-block h-2 w-2 rounded-xs" style={{ background: color }} />
          {name}
        </span>
        <span className="tabular whitespace-nowrap text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text-primary)]">
            {formatMoney(spent, currency)}
          </span>
          {" / "}
          {formatMoney(budget, currency)}
        </span>
      </div>
      <div
        className="h-[7px] w-full overflow-hidden rounded-xs bg-[var(--bg-elevated)]"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${name}: ${formatMoney(spent, currency)} de ${formatMoney(budget, currency)}`}
      >
        <div
          className="h-full rounded-xs transition-[width]"
          style={{ width: `${pct}%`, background: FILL[state] }}
        />
      </div>
      {/* Pasarse no se anuncia sólo con el color del carril: el exceso va en
          cifra, que es lo que de verdad se puede accionar. */}
      {state === "over" && (
        <div className="mt-1 tabular text-2xs text-[var(--gr-oxblood)]">
          {formatMoney(-left, currency)} por encima
        </div>
      )}
    </div>
  );
}
