import { useId, useState } from "react";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { TablerIcon } from "../TablerIcon";
import type { Quest } from "../../types";

/**
 * Las misiones diarias como anillos concéntricos. Adaptado de la «activity
 * card» de Kokonut UI.
 *
 * Las barras decían lo mismo cuatro veces en cuatro filas; los anillos lo dicen
 * de un golpe —¿cuánto del día está cerrado?— y la leyenda de al lado conserva
 * la cifra exacta y el botón de reclamar.
 *
 * Ley del acento: un anillo en curso lleva el degradado de las barras de misión
 * (hacia el arcano: avance, todavía no recompensa). Uno cumplido es oro, porque
 * una misión cumplida es exactamente lo que el oro significa, y al cerrarse
 * suelta un pulso una sola vez.
 */
const STROKE = 9;
const GAP = 3;
const OUTER = 124;
const STAGGER = 0.15;

export function QuestRings({ quests, onClaim }: { quests: Quest[]; onClaim: (q: Quest) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const gid = useId();
  const box = OUTER;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} className="-rotate-90 shrink-0 overflow-visible" role="img"
           aria-label={`${quests.filter((q) => q.completed).length} de ${quests.length} misiones diarias cumplidas`}>
        <defs>
          <linearGradient id={`${gid}-curso`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--gr-xp-from)" />
            <stop offset="100%" stopColor="var(--gr-arcane)" />
          </linearGradient>
          <linearGradient id={`${gid}-oro`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--gr-gilded)" />
            <stop offset="100%" stopColor="var(--gr-gilded-bright)" />
          </linearGradient>
        </defs>
        {quests.map((q, i) => {
          const r = (OUTER - STROKE) / 2 - i * (STROKE + GAP);
          if (r <= STROKE) return null;
          const c = box / 2;
          const ratio = Math.min(1, q.target > 0 ? q.progress / q.target : 0);
          const done = q.completed || q.claimed;
          const dim = active !== null && active !== i;
          const draw = 1 + ratio * 0.4;
          return (
            <g key={q.id} style={{ opacity: dim ? 0.25 : 1, transition: "opacity 200ms var(--gr-ease-out)" }}
               onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)} onPointerLeave={() => setActive(null)}>
              <circle cx={c} cy={c} r={r} fill="none" stroke="var(--gr-surface-raised)" strokeWidth={STROKE} pointerEvents="stroke" />
              {ratio > 0 && (
                <motion.circle
                  cx={c} cy={c} r={r} fill="none" strokeWidth={STROKE} strokeLinecap="round" pointerEvents="none"
                  stroke={`url(#${gid}-${done ? "oro" : "curso"})`}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: ratio }}
                  transition={{ duration: draw, delay: i * STAGGER, ease: [0.23, 1, 0.32, 1] }}
                />
              )}
              {done && (
                /* Pulso de meta, donde el anillo se cierra (arriba, por el giro de −90°). */
                <motion.circle
                  cx={c + r} cy={c} r={STROKE / 2} fill="none" stroke="var(--gr-gilded-bright)" strokeWidth={2}
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                  initial={{ scale: 1, opacity: 0 }}
                  animate={{ scale: [1, 2.6], opacity: [0.7, 0] }}
                  transition={{ duration: 0.6, delay: i * STAGGER + draw, ease: [0.23, 1, 0.32, 1] }}
                />
              )}
            </g>
          );
        })}
      </svg>

      <ul className="min-w-[180px] flex-1 space-y-1.5">
        {quests.map((q, i) => {
          const done = q.completed || q.claimed;
          const claimable = q.completed && !q.claimed;
          return (
            <li key={q.id}
                className="flex items-center gap-2 text-sm transition-opacity duration-200"
                style={{ opacity: active !== null && active !== i ? 0.4 : 1 }}
                onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)} onPointerLeave={() => setActive(null)}>
              <TablerIcon name={q.icon} size={14} className={done ? "text-[var(--gr-gilded)]" : "text-[var(--text-muted)]"} />
              <span className={`flex-1 ${q.claimed ? "text-[var(--text-faint)] line-through" : "text-[var(--text-body)]"}`}>{q.title}</span>
              <span className="tabular text-xs text-[var(--text-muted)]">
                <NumberFlow value={q.progress} />/{q.target}
              </span>
              {claimable ? (
                <button onClick={() => onClaim(q)} className="gr-reward rounded border border-[var(--gr-gilded)] bg-[var(--gr-gilded-deep)] px-1.5 py-0.5 font-label text-xs text-[var(--gr-gilded-bright)] hover:border-[var(--gr-gilded-bright)]">
                  +{q.xp_reward}
                </button>
              ) : (
                <span className="font-label text-xs text-[var(--text-faint)]">{q.claimed ? "✓" : `+${q.xp_reward}`}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
