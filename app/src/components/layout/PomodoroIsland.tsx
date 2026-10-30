import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, type Transition } from "motion/react";
import NumberFlow from "@number-flow/react";
import { IconArrowUpRight, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import type { Phase, usePomodoro } from "../../hooks/usePomodoro";
import type { Task } from "../../types";

// TODO(fase-N): antes salía de usePomodoroCtx() (pomodoro-context, que llama a la API).
export type PomodoroIslandState = Pick<
  ReturnType<typeof usePomodoro>,
  "running" | "secondsLeft" | "totalSeconds" | "phase" | "progress" | "pause" | "start"
> & { activeTask: Task | null };

/**
 * El Pomodoro, visible desde cualquier vista. Adaptado de la «status island» de
 * Kokonut UI: una píldora que cambia de forma y se abre al pasar por encima.
 *
 * Antes, salir de la vista del Pomodoro era perderlo de vista: seguía corriendo
 * (vive en un contexto) pero nada decía cuánto quedaba ni dejaba pausarlo sin
 * volver. La isla no aparece en la propia vista del Pomodoro, donde el dial ya
 * lo cuenta todo, ni con el temporizador quieto en su fase entera.
 *
 * Arcano, no oro: un bloque en curso es estado del sistema. El oro llega cuando
 * el bloque se cumple y paga, y eso lo anuncia el toast, no esto.
 */
const MORPH: Transition = { type: "spring", duration: 0.45, bounce: 0.18 };
const PHASE_LABEL: Record<Phase, string> = { work: "Foco", short: "Descanso", long: "Descanso largo" };
const R = 7;
const C = 2 * Math.PI * R;

export function PomodoroIsland({ pomo }: { pomo: PomodoroIslandState }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const started = pomo.running || pomo.secondsLeft < pomo.totalSeconds;
  const visible = started && pathname !== "/pomodoro";
  const expanded = open && visible;

  // Un toque fuera la cierra en pantallas táctiles.
  useEffect(() => {
    if (!expanded) return;
    const close = (e: globalThis.PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [expanded]);

  const mins = Math.floor(pomo.secondsLeft / 60);
  const secs = pomo.secondsLeft % 60;
  const label = PHASE_LABEL[pomo.phase];

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex justify-end">
      <AnimatePresence>
        {visible && (
          <motion.div
            key="isla"
            ref={ref}
            layout
            initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 12, filter: "blur(4px)" }}
            transition={MORPH}
            style={{ borderRadius: expanded ? 14 : 22 }}
            className="pointer-events-auto overflow-hidden border border-[var(--gr-edge-strong)] bg-[var(--gr-surface-raised)] shadow-[inset_0_1px_0_var(--gr-edge-inner),0_10px_30px_rgba(0,0,0,0.5)]"
            onPointerEnter={(e: PointerEvent) => e.pointerType === "mouse" && setOpen(true)}
            onPointerLeave={(e: PointerEvent) => e.pointerType === "mouse" && setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={(e: FocusEvent<HTMLDivElement>) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
            }}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          >
            <motion.div layout="position" className="flex h-11 items-center gap-2.5 pl-3.5 pr-4">
              <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90 shrink-0" aria-hidden>
                <circle cx="9" cy="9" r={R} fill="none" stroke="var(--gr-edge-strong)" strokeWidth="2" />
                <circle
                  cx="9" cy="9" r={R} fill="none" stroke="var(--gr-arcane)" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={C} strokeDashoffset={C * (1 - pomo.progress)}
                  style={{ transition: "stroke-dashoffset 400ms var(--gr-ease-out)" }}
                />
              </svg>
              <span className="font-label text-2xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                {pomo.running ? label : `${label} · en pausa`}
              </span>
              {/* Inter tabular: Cinzel no tiene cifras tabulares, y un reloj que
                  cambia de ancho cada segundo hace bailar la píldora entera. */}
              <span className="tabular text-sm text-[var(--gr-ink-bright)]" aria-label={`${mins} minutos ${secs} segundos`}>
                <NumberFlow value={mins} format={{ minimumIntegerDigits: 2 }} />:
                <NumberFlow value={secs} format={{ minimumIntegerDigits: 2 }} />
              </span>
            </motion.div>

            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  key="detalle"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                  className="w-72 border-t border-[var(--gr-edge)]"
                >
                  <div className="px-3.5 py-3">
                    <div className="truncate text-xs text-[var(--text-body)]">
                      {pomo.activeTask ? pomo.activeTask.title : <span className="italic text-[var(--text-faint)]">Sin tarea vinculada</span>}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="btn btn-primary flex-1 justify-center"
                        onClick={() => (pomo.running ? pomo.pause() : pomo.start())}
                      >
                        {pomo.running ? <><IconPlayerPause size={13} /> Pausar</> : <><IconPlayerPlay size={13} /> Reanudar</>}
                      </button>
                      <button className="btn" onClick={() => navigate("/pomodoro")} title="Abrir el Pomodoro">
                        <IconArrowUpRight size={13} /> Abrir
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
