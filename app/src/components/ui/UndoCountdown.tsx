import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconArrowBackUp } from "@tabler/icons-react";

/**
 * «Deshacer» con la cuenta atrás dibujada alrededor. Adaptado del «undo button»
 * de Kokonut UI.
 *
 * Para borrados frecuentes y de poco peso —un asiento— en lugar de pedir
 * confirmación: la confirmación interrumpe cada vez para proteger del error
 * una vez de cada cien, y el deshacer sólo cuesta algo esa una vez. Lo grave y
 * raro (un proyecto, una partida) sigue pidiendo mantener pulsado.
 *
 * El reloj se para con el puntero encima y con la ventana oculta: nadie tiene
 * que perder la ocasión de deshacer mientras lo está leyendo, y una cuenta
 * atrás no puede correr con la app de fondo (la misma lección que el Pomodoro:
 * no contar tiempo que nadie vio). Ctrl+Z también deshace.
 *
 * Si el componente desaparece a mitad —se cambia de vista— el borrado se
 * consuma: era lo que se pidió, y dejarlo a medias sería peor que cualquiera de
 * las dos cosas.
 */
const STROKE = 1.5;

function pillPath(w: number, h: number) {
  const s = STROKE / 2;
  const r = h / 2 - s;
  const left = s + r;
  const right = w - s - r;
  return `M ${w / 2} ${s} H ${right} A ${r} ${r} 0 0 1 ${right} ${h - s} H ${left} A ${r} ${r} 0 0 1 ${left} ${s} Z`;
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function UndoCountdown({ ms = 5000, onUndo, onCommit }: { ms?: number; onUndo: () => void; onCommit: () => void }) {
  const [seconds, setSeconds] = useState(Math.ceil(ms / 1000));
  const btn = useRef<HTMLButtonElement>(null);
  const path = useRef<SVGPathElement>(null);
  const hovered = useRef(false);
  const settled = useRef(false);
  const alive = useRef(true);
  const cb = useRef({ onUndo, onCommit });
  cb.current = { onUndo, onCommit };

  const settle = useCallback((how: "undo" | "commit") => {
    if (settled.current) return;
    settled.current = true;
    if (how === "undo") cb.current.onUndo();
    else cb.current.onCommit();
  }, []);

  useLayoutEffect(() => {
    const b = btn.current;
    if (b) path.current?.setAttribute("d", pillPath(b.offsetWidth, b.offsetHeight));
  }, []);

  useEffect(() => {
    alive.current = true;
    let elapsed = 0;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      if (!(hovered.current || document.hidden)) elapsed += now - last;
      last = now;
      const left = Math.max(0, ms - elapsed);
      const p = path.current;
      if (p) {
        // Longitudes reales y no pathLength, que Chrome escala mal al cambiar de tamaño.
        const len = p.getTotalLength();
        p.style.strokeDasharray = `${(len * left) / ms} ${len}`;
      }
      setSeconds(Math.ceil(left / 1000));
      if (left === 0) { settle("commit"); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !isEditable(e.target)) {
        e.preventDefault();
        settle("undo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      // StrictMode desmonta y vuelve a montar en desarrollo: sólo es una salida
      // de verdad si el efecto no ha vuelto a correr en el tick siguiente.
      alive.current = false;
      setTimeout(() => { if (!alive.current) settle("commit"); }, 0);
    };
  }, [ms, settle]);

  return (
    <button
      ref={btn}
      type="button"
      onClick={() => settle("undo")}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") hovered.current = true; }}
      onPointerLeave={() => { hovered.current = false; }}
      aria-label={`Borrado. Deshacer, quedan ${seconds} segundos`}
      className="relative inline-flex h-6 items-center gap-1 rounded-full px-2.5 font-label text-2xs uppercase tracking-[0.08em] text-[var(--gr-ink)] hover:text-[var(--gr-ink-bright)]"
    >
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <path ref={path} fill="none" stroke="var(--gr-arcane)" strokeWidth={STROKE} strokeLinecap="round" />
      </svg>
      <IconArrowBackUp size={12} />
      Deshacer
      <span className="tabular text-[var(--text-muted)]">{seconds}</span>
    </button>
  );
}
