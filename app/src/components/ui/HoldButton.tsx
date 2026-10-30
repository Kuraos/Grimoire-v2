import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from "motion/react";
import { isReduced } from "../../motion-pref";

/**
 * Mantener pulsado para confirmar. Adaptado del «hold button» de Kokonut UI.
 *
 * Un clic se da sin querer; mantener un segundo, no. Por eso va donde un error
 * no se deshace —borrar— y donde el acto merece peso —sellar el mes—. El
 * relleno sigue al dedo, vuelve atrás si se suelta antes (más rápido cuanto
 * menos se llenó) y al completarse la etiqueta rueda a una marca dibujada.
 *
 * Dos tonos y ninguno más: `danger` en oxblood para lo que destruye, `gilded`
 * para lo que se gana. Un tercer color sería un botón que no sabe qué es.
 */
type Tone = "danger" | "gilded";

const TONE: Record<Tone, { border: string; ink: string; fill: string; solid: string; solidInk: string }> = {
  danger: {
    border: "var(--gr-edge-danger)", ink: "var(--gr-oxblood)", fill: "var(--gr-oxblood-deep)",
    solid: "var(--gr-oxblood)", solidInk: "var(--gr-void)",
  },
  gilded: {
    border: "var(--gr-gilded)", ink: "var(--gr-gilded-bright)", fill: "var(--gr-gilded-deep)",
    solid: "var(--gr-gilded)", solidInk: "var(--gr-void)",
  },
};

const HOLD_KEYS = new Set([" ", "Enter"]);
const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
/** Lo que tarda en vaciarse un relleno completo al soltar antes de tiempo. */
const DRAIN_MS = 300;
/** La etiqueta de «sigue» espera esto: un toque rápido no la hace parpadear. */
const LABEL_DELAY_MS = 150;

type Phase = "idle" | "holding" | "complete";

export function HoldButton({ tone = "danger", children, holdingLabel = "Sigue…", completeLabel, icon, holdMs = 1100, onComplete, className = "", autoFocus }: {
  tone?: Tone;
  children: ReactNode;
  holdingLabel?: ReactNode;
  completeLabel: ReactNode;
  icon?: ReactNode;
  holdMs?: number;
  onComplete: () => void;
  className?: string;
  autoFocus?: boolean;
}) {
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [showHolding, setShowHolding] = useState(false);
  const phaseRef = useRef<Phase>("idle");
  const progress = useMotionValue(0);
  const clipPath = useTransform(progress, (p) => `inset(0 ${(1 - p) * 100}% 0 0)`);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(onComplete);
  done.current = onComplete;
  const c = TONE[tone];

  useEffect(() => () => { anim.current?.stop(); if (labelTimer.current) clearTimeout(labelTimer.current); }, []);

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
    if (labelTimer.current) clearTimeout(labelTimer.current);
    if (next === "holding") labelTimer.current = setTimeout(() => setShowHolding(true), LABEL_DELAY_MS);
    else setShowHolding(false);
  };

  const start = () => {
    if (phaseRef.current !== "idle") return;
    setPhase("holding");
    anim.current?.stop();
    // Retoma desde donde lo dejó un vaciado a medias.
    anim.current = animate(progress, 1, {
      duration: ((1 - progress.get()) * holdMs) / 1000,
      ease: "linear",
      onComplete: () => {
        if (phaseRef.current !== "holding") return;
        setPhase("complete");
        // Un instante para que se vea la marca antes de que el diálogo se cierre.
        setTimeout(() => done.current(), isReduced() ? 0 : 380);
      },
    });
  };

  const end = () => {
    if (phaseRef.current !== "holding") return;
    setPhase("idle");
    anim.current?.stop();
    anim.current = animate(progress, 0, { duration: isReduced() ? 0 : (progress.get() * DRAIN_MS) / 1000, ease: EASE });
  };

  const key = phase === "holding" && !showHolding ? "idle" : phase;
  const label = key === "complete" ? completeLabel : key === "holding" ? holdingLabel : children;
  const complete = phase === "complete";

  return (
    <button
      type="button"
      autoFocus={autoFocus}
      className={`relative inline-flex h-9 min-w-40 touch-none select-none items-center justify-center overflow-hidden rounded-md border px-4 font-label text-xs uppercase tracking-[0.08em] transition-colors duration-150 ${className}`}
      style={{ borderColor: complete ? c.solid : c.border, color: complete ? c.solidInk : c.ink, background: complete ? c.solid : "transparent" }}
      aria-label={typeof children === "string" ? `${children} (mantén pulsado)` : undefined}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        // El tacto captura el puntero solo, y la pulsación seguiría aunque el
        // dedo se saliera del botón. Liberarlo deja que pointerleave cancele.
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      onBlur={end}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        if (!HOLD_KEYS.has(e.key)) return;
        e.preventDefault(); // ni Enter dispara el clic ni Espacio desplaza
        e.stopPropagation(); // ni el atajo global de Espacio ni el Enter del diálogo
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => HOLD_KEYS.has(e.key) && end()}
    >
      <motion.span aria-hidden className="pointer-events-none absolute inset-0" style={{ clipPath, background: c.fill, opacity: complete ? 0 : 1 }} />
      <span className="relative flex items-center justify-center overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={key}
            className="inline-flex items-center gap-2 whitespace-nowrap"
            initial={{ opacity: 0, y: 10, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(2px)" }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {key === "complete" ? (
              <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none">
                <motion.path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                             initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay: 0.1, ease: EASE }} />
              </svg>
            ) : icon}
            {label}
          </motion.span>
        </AnimatePresence>
      </span>
      <span aria-live="polite" className="sr-only">{complete ? completeLabel : ""}</span>
    </button>
  );
}
