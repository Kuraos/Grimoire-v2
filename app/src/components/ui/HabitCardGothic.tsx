import { useState } from "react";
import { IconFlame, IconAlertTriangle, IconArchiveOff } from "@tabler/icons-react";
import type { Habit } from "../../types";
import { cadenceLabel, scheduledToday, streakUnit } from "../../utils";

/**
 * Card de hábito. Usa exclusivamente tokens `gr-*` (ver src/theme.css).
 * El estado lo manda el servidor; lo único local es la animación de recompensa.
 *
 * Jerarquía de color aplicada:
 *   arcano (frío)  -> estado del sistema: seleccionado, foco, completado
 *   dorado (cálido)-> recompensa: racha, XP  (manuscrito iluminado)
 *   ámbar          -> advertencia: racha en riesgo
 */
export function HabitCardGothic({ habit, onComplete, onUndo, onOpen, onRestore }: {
  habit: Habit;
  onComplete?: (h: Habit) => void;
  onUndo?: (h: Habit) => void;
  onOpen?: (h: Habit) => void;
  onRestore?: (h: Habit) => void;
}) {
  const archived = habit.active === false;
  // estado controlado por el servidor; lo local es sólo la animación
  const done = habit.done_today;
  const [rewarding, setRewarding] = useState(false);

  // Sólo está en riesgo si hoy tocaba: un hábito L–V no corre peligro en sábado.
  const atRisk = !done && habit.streak > 0 && scheduledToday(habit);

  const toggle = () => {
    if (done) {
      onUndo?.(habit);
      return;
    }
    // micro-interacción de recompensa: 420ms, scale + glow dorado
    setRewarding(true);
    setTimeout(() => setRewarding(false), 420);
    onComplete?.(habit);
  };

  return (
    <article className={`card gr-enter ${rewarding ? "gr-reward" : ""}`}
             style={archived ? { opacity: 0.62, borderStyle: "dashed" } : undefined}>
      <div className="flex items-start gap-3">
        {/* Archivado: en vez de completar, se ofrece recuperar */}
        {archived ? (
          <button
            onClick={() => onRestore?.(habit)}
            title="Restaurar este hábito"
            aria-label={`Restaurar ${habit.name}`}
            className="mt-[2px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md border"
            style={{ borderColor: "var(--gr-edge-strong)", color: "var(--gr-ink-dim)" }}
          >
            <IconArchiveOff size={13} />
          </button>
        ) : (
        /* Sello de completado — el trazo se dibuja, no aparece de golpe */
        <button
          onClick={toggle}
          aria-pressed={done}
          aria-label={done ? `Deshacer ${habit.name}` : `Completar ${habit.name}`}
          className="mt-[2px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md border transition-colors"
          style={{
            borderColor: done ? "var(--gr-gilded)" : "var(--gr-edge-strong)",
            background: done ? "var(--gr-gilded-deep)" : "transparent",
            transitionDuration: "var(--gr-dur-state)",
            transitionTimingFunction: "var(--gr-ease-out)",
          }}
        >
          {done && (
            <svg className="gr-seal" width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="var(--gr-gilded-bright)" strokeWidth="3.5"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12.5l5.5 5.5L20 6.5" />
            </svg>
          )}
        </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3
              className={`gr-body truncate font-medium ${onOpen ? "cursor-pointer hover:underline" : ""}`}
              onClick={() => onOpen?.(habit)}
              style={{
                color: done ? "var(--gr-ink-dim)" : "var(--gr-ink-bright)",
                textDecoration: done ? "line-through" : "none",
              }}
            >
              {habit.name}
            </h3>
            <span className="gr-meta shrink-0" style={{ color: "var(--gr-ink-faint)" }}>
              {archived ? "archivado" : cadenceLabel(habit)}
            </span>
          </div>

          {/* Metadata: categoría + recompensa. El dorado marca lo que se gana. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="gr-meta inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full"
                    style={{ background: habit.color, boxShadow: `0 0 6px ${habit.color}66` }} />
              {habit.category}
            </span>

            <span
              className="gr-meta gr-numeric inline-flex items-center gap-1 rounded-full px-2 py-[2px]"
              style={{
                color: "var(--gr-gilded)",
                background: "var(--gr-gilded-deep)",
                border: "1px solid rgba(220,174,92,0.22)",
              }}
            >
              +{habit.xp_reward} XP
            </span>

            {habit.streak > 0 && (
              <span
                className="gr-meta gr-numeric inline-flex items-center gap-1"
                style={{ color: atRisk ? "var(--gr-amber)" : "var(--gr-gilded)" }}
                title={atRisk ? "Racha en riesgo: aún no completado hoy" : "Racha activa"}
              >
                {atRisk ? <IconAlertTriangle size={13} /> : <IconFlame size={13} />}
                {habit.streak} {streakUnit(habit, habit.streak)}
              </span>
            )}
          </div>
        </div>

        {/* Progreso histórico — dato, no adorno */}
        <div className="shrink-0 text-right">
          <div className="gr-numeric gr-body font-medium" style={{ color: "var(--gr-ink)" }}>
            {habit.completion_rate}%
          </div>
          <div className="gr-meta" style={{ color: "var(--gr-ink-faint)" }}>constancia</div>
        </div>
      </div>
    </article>
  );
}
