import { ReactNode } from "react";
import {
  IconPlayerPlay, IconPlayerPause, IconRotateClockwise, IconPlayerSkipForward, IconClock,
} from "@tabler/icons-react";
import { formatTime, CYCLE_LENGTH, type Phase } from "../../hooks/usePomodoro";
import { spoke } from "../../polar";

const PHASE_LABEL: Record<Phase, string> = {
  work: "Foco",
  short: "Descanso corto",
  long: "Descanso largo",
};

/* ── La esfera ──────────────────────────────────────────────────────────────
   Una marca por minuto de la fase, repartidas en círculo desde arriba, y un
   filete más largo cada cinco. Lo transcurrido se enciende en arcano.

   Una barra recta dice qué fracción va; la esfera dice además *cuántos minutos
   quedan* sin leer la cifra, porque las marcas se cuentan. Es la diferencia
   entre un progreso y un reloj, y esto último es lo que se está mirando.

   El arcano y no el oro, por la misma razón de siempre: el tiempo que pasa es
   estado del sistema, no recompensa. El oro entra al cerrar el bloque, en los
   rombos del ciclo. */
const CX = 160;
const R_RING_OUT = 150;
const R_RING_IN = 104;
const R_TICK_IN = 112;
const R_TICK_OUT = 142;
const R_QUARTER_IN = 144;
const R_QUARTER_OUT = 150;

const tick = (deg: number, r0: number, r1: number) => spoke(CX, deg, r0, r1);

function Dial({ totalMinutes, elapsedMinutes }: { totalMinutes: number; elapsedMinutes: number }) {
  const pending: string[] = [];
  const elapsed: string[] = [];
  const quarters: string[] = [];
  const full = elapsedMinutes >= totalMinutes;

  for (let i = 0; i < totalMinutes; i++) {
    const deg = (i * 360) / totalMinutes;
    (i < elapsedMinutes ? elapsed : pending).push(tick(deg, R_TICK_IN, R_TICK_OUT));
    if (i % 5 === 0) quarters.push(tick(deg, R_QUARTER_IN, R_QUARTER_OUT));
  }

  return (
    <svg width="320" height="320" viewBox="0 0 320 320" className="block h-full w-full" aria-hidden>
      <circle cx={CX} cy={CX} r={R_RING_OUT} stroke="var(--gr-edge)" strokeWidth="1" fill="none" />
      <circle cx={CX} cy={CX} r={R_RING_IN} stroke="var(--gr-edge)" strokeWidth="1" fill="none" />
      <path d={pending.join(" ")} stroke="var(--gr-edge)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      {/* Lo corrido en arcano mientras la fase vive: el tiempo que pasa es
          estado del sistema, no premio. Al cerrarse la fase entera la esfera
          pasa a oro de golpe — entonces sí hay bloque ganado. */}
      <path d={elapsed.join(" ")} stroke={full ? "var(--gr-gilded)" : "var(--gr-arcane)"}
            strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d={quarters.join(" ")} stroke="var(--border-strong)" strokeWidth="1" fill="none" />
    </svg>
  );
}

/**
 * El ciclo de cuatro, en rombos. Vive en la cabecera de la vista y no junto al
 * mando: no es un control del temporizador sino el estado del día, igual que
 * las cifras de la línea de contexto que tiene al lado.
 *
 * El bloque cumplido sí es recompensa —cuenta para el descanso largo y para
 * los logros de foco—, así que se rellena de oro; lo que falta se queda hueco,
 * con el filo por todo dibujo.
 */
export function PomodoroCycle({ done }: { done: number }) {
  return (
    <div className="flex items-center gap-2" role="img"
         aria-label={`${done} de ${CYCLE_LENGTH} bloques de foco del ciclo`}>
      <span className="font-label text-2xs text-[var(--text-muted)]">Ciclo</span>
      {Array.from({ length: CYCLE_LENGTH }, (_, i) => (
        <span
          key={i}
          className="h-[7px] w-[7px] rotate-45"
          style={{
            background: i < done ? "var(--gr-gilded)" : "transparent",
            border: `1px solid ${i < done ? "var(--gr-gilded)" : "var(--border-strong)"}`,
          }}
        />
      ))}
      <span className="tabular text-xs text-[var(--text-faint)]">{done}/{CYCLE_LENGTH}</span>
    </div>
  );
}

export function PomodoroTimer({
  phase, secondsLeft, totalSeconds, running, progress, subtitle,
  onStart, onPause, onReset, onSkip, big = true, side,
}: {
  phase: Phase;
  secondsLeft: number;
  /** Duración de la fase. Sólo la esfera la necesita. */
  totalSeconds?: number;
  running: boolean;
  progress: number;
  subtitle?: string;
  onStart: () => void;
  onPause: () => void;
  onReset?: () => void;
  onSkip?: () => void;
  big?: boolean;
  /** Controles de la vista que acompañan al mando, en la columna de la derecha. */
  side?: ReactNode;
}) {
  /* La cifra va en el rol de rúbrica (44px) y no en Cinzel: Cinzel no tiene
     versión tabular de los dígitos —`tabular-nums` no le hace nada— y "11:11"
     medía menos que "25:00", así que la cuenta atrás saltaba de lado cada vez
     que entraba o salía un 1. Con Inter tabular la oscilación es 0. */
  const figure = (
    <div className="gr-figure font-bold text-[var(--gr-arcane-bright)]" style={{ fontSize: big ? 44 : 34 }}>
      {formatTime(secondsLeft)}
    </div>
  );

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {running ? (
        <button className="btn btn-primary" onClick={onPause}><IconPlayerPause size={13} /> Pausar</button>
      ) : (
        <button className="btn btn-primary" onClick={onStart}><IconPlayerPlay size={13} /> Iniciar</button>
      )}
      {onReset && <button className="btn" onClick={onReset}><IconRotateClockwise size={13} /> Reiniciar</button>}
      {onSkip && <button className="btn" onClick={onSkip}><IconPlayerSkipForward size={13} /> Saltar fase</button>}
    </div>
  );

  /* En card la esfera no cabe: 320px al lado de una lista de hábitos deja de
     ser un reloj y pasa a ser la vista entera. Ahí manda la cifra.

     La cifra a la izquierda y los mandos apilados a la derecha, sin barra de
     progreso. Centrado y con barra, la card crecía a lo alto hasta igualar a
     las de al lado y el Pomodoro pesaba en el Dashboard lo mismo que los
     hábitos, que son la rúbrica. Compacto vuelve a ser lo que es: un mando. */
  if (!big) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div>
          {figure}
          <div className="mt-0.5 text-xs italic text-[var(--text-muted)]">
            {PHASE_LABEL[phase]}{subtitle ? ` — ${subtitle}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {running ? (
            <button className="btn btn-primary justify-center" onClick={onPause}>
              <IconPlayerPause size={13} /> Pausar
            </button>
          ) : (
            <button className="btn btn-primary justify-center" onClick={onStart}>
              <IconPlayerPlay size={13} /> Iniciar
            </button>
          )}
          {side}
        </div>
      </div>
    );
  }

  const totalMinutes = Math.max(1, Math.round((totalSeconds ?? 25 * 60) / 60));
  const elapsedMinutes = Math.min(totalMinutes, Math.round(progress * totalMinutes));

  return (
    <div className="flex flex-wrap items-center gap-7">
      <div className="relative h-[320px] w-[320px] shrink-0">
        <Dial totalMinutes={totalMinutes} elapsedMinutes={elapsedMinutes} />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          {figure}
          <div className="gr-rubrica text-[var(--text-muted)]">{PHASE_LABEL[phase]}</div>
          {subtitle && (
            <div className="max-w-[170px] text-center text-xs italic leading-snug text-[var(--text-faint)] [text-wrap:pretty]">
              {subtitle}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-[220px] flex-1 flex-col gap-3.5">
        <div className="flex items-center gap-2 font-label text-xs text-[var(--text-muted)]">
          <IconClock size={14} />
          <span className="gr-rubrica">Temporizador</span>
          <span className="h-px flex-1 bg-[var(--gr-edge)]" />
          <span className="gr-rombo" />
        </div>
        {controls}
        {side}
        {/* La cadena cierra la columna: es el único eslabonado de la vista y
            marca dónde acaba el mando del temporizador. */}
        <div className="flex items-center gap-2.5">
          <span className="gr-cadena opacity-60" />
          <span className="gr-rombo" />
        </div>
      </div>
    </div>
  );
}
