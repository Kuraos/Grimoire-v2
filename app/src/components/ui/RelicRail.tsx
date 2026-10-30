import { IconCheck } from "@tabler/icons-react";
import { formatMoney } from "../../utils";
import type { SavingsGoal } from "../../types";

/**
 * El carril de una reliquia.
 *
 * Es el único sitio del erario, junto al cierre del mes, donde el oro está
 * permitido: una meta de ahorro es algo que el usuario se fijó y cumplió, igual
 * que una misión. Mientras va en camino el progreso es ARCANO —estado del
 * sistema, no recompensa— y sólo se vuelve dorado al llegar.
 *
 * Un saldo alto no es oro. Una reliquia alcanzada sí.
 */
export function RelicRail({ goal, currency, onContribute }: {
  goal: SavingsGoal;
  currency: string;
  onContribute?: (goal: SavingsGoal) => void;
}) {
  const done = goal.achieved_at !== null;
  const pct = Math.max(0, Math.min(100, (goal.saved_minor / goal.target_minor) * 100));
  const left = goal.target_minor - goal.saved_minor;

  return (
    <div className="flex items-start gap-3.5"
         role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
         aria-label={`${goal.name}: ${formatMoney(goal.saved_minor, currency)} de ${formatMoney(goal.target_minor, currency)}`}>
      <RelicRing pct={pct} done={done} color={goal.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-[var(--text-primary)]">{goal.name}</span>
          {done && (
            <span className="shrink-0 font-label text-2xs text-[var(--gr-gilded)]">Reliquia obtenida</span>
          )}
        </div>
        <div className="mt-0.5 tabular text-xs text-[var(--text-muted)]">
          <span className={done ? "text-[var(--gr-gilded-bright)]" : "text-[var(--text-body)]"}>
            {formatMoney(goal.saved_minor, currency)}
          </span>
          {" de "}
          {formatMoney(goal.target_minor, currency)}
        </div>
        {!done && (
          <div className="mt-1 flex items-baseline gap-2 text-2xs">
            <span className="tabular text-[var(--text-faint)]">
              Faltan {formatMoney(left, currency)}
              {goal.deadline ? ` · antes del ${goal.deadline}` : ""}
            </span>
            {onContribute && (
              <button className="text-[var(--purple-main)] hover:underline" onClick={() => onContribute(goal)}>
                Aportar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * El anillo de una reliquia.
 *
 * Un arco que se cierra dice «cuánto falta para completar la vuelta», que es
 * exactamente la forma de una meta. Una barra recta dice la misma fracción pero
 * sin la promesa de cierre, y el cierre es el punto: **el anillo sólo se cierra
 * cuando la meta se cumple**, y ese es el instante en que el arcano pasa a oro.
 *
 * Mientras va en camino el arco es arcano —estado del sistema, no recompensa—.
 * Un saldo alto no es oro; una reliquia alcanzada sí.
 */
function RelicRing({ pct, done, color }: { pct: number; done: boolean; color: string }) {
  const R = 20;
  const C = 2 * Math.PI * R;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none" className="shrink-0" aria-hidden>
      <circle cx="26" cy="26" r={R} stroke="var(--gr-edge)" strokeWidth="3" />
      <circle
        cx="26" cy="26" r={R}
        stroke={done ? "var(--gr-gilded)" : "var(--gr-arcane)"}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * C} ${C}`}
        transform="rotate(-90 26 26)"
      />
      {/* El punto de color de la meta vive dentro del anillo: identifica sin
          competir con el arco, que es lo que hay que leer. */}
      {done ? (
        <IconCheck size={16} x={18} y={18} className="text-[var(--gr-gilded-bright)]" />
      ) : (
        <text x="26" y="30" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="11"
              fontWeight="600" fill={color}>
          {Math.round(pct)}
        </text>
      )}
    </svg>
  );
}
