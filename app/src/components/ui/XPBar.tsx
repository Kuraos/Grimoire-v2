import { IconSkull, IconFlame } from "@tabler/icons-react";
import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { useUser } from "../../context";
import { motionTokens } from "../../theme-tokens";

/**
 * Ley del acento: aquí todo es recompensa —nivel, bonus de racha, XP del día—
 * así que todo va en dorado. El arcano no entra en esta card.
 */
export function XPBar({ xpToday, streakBonus }: { xpToday?: number; streakBonus?: number }) {
  const user = useUser();
  if (!user) {
    return <div className="card xp-section">Cargando…</div>;
  }
  const pct = Math.min(100, Math.round((user.xp_into_level / user.xp_span) * 100));
  const hasBonus = streakBonus !== undefined && streakBonus > 1;

  return (
    <div className="card">
      <div className="mb-1.5 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gr-gilded)] bg-[var(--gr-gilded-deep)] px-2.5 py-[3px] font-display text-sm text-[var(--gr-gilded-bright)]">
          <IconSkull size={14} /> Nivel {user.level}
        </div>
        <span className="text-xs italic text-[var(--text-body)]">{user.title}</span>
        {hasBonus && (
          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--gr-gilded)] bg-[var(--gr-gilded-deep)] px-2 py-[2px] font-label text-xs text-[var(--gr-gilded-bright)]" title="Bonus de racha activo">
            <IconFlame size={12} /> ×{streakBonus!.toFixed(2)}
          </span>
        )}
        {xpToday !== undefined && (
          <span className="ml-auto text-xs text-[var(--gr-gilded)]">+<NumberFlow value={xpToday} locales="es" /> XP hoy</span>
        )}
      </div>
      <div className="my-1.5 h-2 overflow-hidden rounded bg-[var(--bg-elevated)]">
        {/* Se llena desde cero al montar y desde donde estaba al ganar XP: el
            avance se ve ocurrir, que es el punto de pintarlo. Curva de
            recompensa (con su leve rebase) porque esto sí es recompensa. */}
        <motion.div
          className="h-full rounded"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: motionTokens().reward * 2, ease: motionTokens().easeReward }}
          style={{ background: "linear-gradient(90deg, var(--xp-from), var(--xp-to))" }}
        />
      </div>
      <div className="flex justify-between text-xs tabular text-[var(--text-body)]">
        <span>
          <NumberFlow value={user.xp} locales="es" /> XP · <NumberFlow value={user.xp_into_level} locales="es" />/{user.xp_span} al siguiente nivel
        </span>
        <span>Nivel {user.level + 1}</span>
      </div>
    </div>
  );
}
