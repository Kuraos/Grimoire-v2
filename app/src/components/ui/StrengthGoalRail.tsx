import { IconCheck } from "@tabler/icons-react";
import { formatWeight, type WeightUnit } from "../../utils";
import type { StrengthGoal } from "../../types";

/**
 * El carril de una meta de fuerza.
 *
 * Es el anillo de la reliquia del erario con otras unidades, y lleva el oro por
 * la misma razón: **una meta que el usuario fijó ANTES y cumplió**, igual que
 * una misión. Mientras va en camino el arco es ARCANO —estado del sistema, no
 * recompensa— y sólo se vuelve dorado al cerrarse.
 *
 * Levantar mucho no es oro. Una meta declarada y alcanzada sí. La diferencia no
 * es sutil: un récord es una cifra que se teclea sin validación posible, y
 * premiarlo premiaría la genética y la sinceridad. Una meta se fija antes de
 * saber si se va a cumplir, y eso la convierte en un compromiso.
 */
export function StrengthGoalRail({ goal, exerciseName, unit, onDelete }: {
  goal: StrengthGoal;
  exerciseName: string;
  unit: WeightUnit;
  onDelete?: (goal: StrengthGoal) => void;
}) {
  const done = goal.achieved_at !== null;
  // Una meta a peso corporal —diez dominadas sin lastre— no tiene fracción de
  // peso que mostrar: su progreso es sí o no, y sale de si alguna serie llegó.
  const bodyweight = goal.target_weight_g === 0;
  const pct = bodyweight
    ? (goal.qualifying_sets > 0 ? 100 : 0)
    : Math.max(0, Math.min(100, (goal.best_weight_g / goal.target_weight_g) * 100));
  const left = goal.target_weight_g - goal.best_weight_g;

  const objetivo = bodyweight
    ? `${goal.target_reps} reps`
    : `${formatWeight(goal.target_weight_g, unit)}${goal.target_reps > 1 ? ` × ${goal.target_reps}` : ""}`;

  /* El peso puede estar alcanzado sin que la meta esté sellada, y es la regla,
     no un fallo: sellar exige una serie POSTERIOR, o bajar la cifra por debajo
     de lo que ya se levanta la cumpliría sola. Lo que fallaba era decirlo —
     «Faltan 0 kg» afirma que no falta nada junto a un anillo que no es de oro—.
     El caso a peso corporal ya lo nombraba bien; éste ahora usa sus palabras. */
  const plazo = goal.deadline ? ` · antes del ${goal.deadline}` : "";
  const estado = done
    ? `Sellada el ${goal.achieved_at!.slice(0, 10)}`
    : bodyweight
      ? `Aún sin una serie de ${goal.target_reps}`
      : left > 0
        ? `Faltan ${formatWeight(left, unit)}${plazo}`
        : `Aún sin una serie posterior${plazo}`;

  return (
    <div
      className="flex items-start gap-3.5"
      role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
      aria-label={`${exerciseName}: objetivo ${objetivo}`}
    >
      <GoalRing pct={pct} done={done} color={goal.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-[var(--text-primary)]">
            {exerciseName} · {objetivo}
          </span>
          {done && (
            <span className="shrink-0 font-label text-2xs text-[var(--gr-gilded)]">
              Meta alcanzada
            </span>
          )}
        </div>
        <div className="mt-0.5 tabular text-xs text-[var(--text-muted)]">
          {bodyweight ? (
            <span className={done ? "text-[var(--gr-gilded-bright)]" : "text-[var(--text-body)]"}>
              {goal.qualifying_sets} series de {goal.target_reps}+ reps
            </span>
          ) : (
            <>
              <span className={done ? "text-[var(--gr-gilded-bright)]" : "text-[var(--text-body)]"}>
                {formatWeight(goal.best_weight_g, unit)}
              </span>
              {" de "}
              {formatWeight(goal.target_weight_g, unit)}
            </>
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-2 text-2xs">
          <span className="tabular text-[var(--text-faint)]">{estado}</span>
          {onDelete && !done && (
            <button className="text-[var(--purple-main)] hover:underline" onClick={() => onDelete(goal)}>
              Retirar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * El anillo. Un arco que se cierra dice «cuánto falta para completar la vuelta»,
 * que es exactamente la forma de una meta — y **el anillo sólo se cierra cuando
 * se cumple**, que es el instante en que el arcano pasa a oro.
 */
function GoalRing({ pct, done, color }: { pct: number; done: boolean; color: string }) {
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
