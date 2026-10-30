import { useCallback, useEffect, useRef, useState } from "react";

export type Phase = "work" | "short" | "long";

export interface PomodoroConfig {
  work: number; // minutes
  short: number;
  long: number;
}

export const DEFAULT_CONFIG: PomodoroConfig = { work: 25, short: 5, long: 15 };

/** Un ciclo son cuatro bloques de foco; el cuarto da descanso largo. */
export const CYCLE_LENGTH = 4;

/** Por debajo de un minuto no hay foco que registrar, sólo ruido. */
const MIN_PARTIAL_MINUTES = 1;

/**
 * Lo que sobrevive a cerrar la app. Sólo primitivos, porque se serializa tal
 * cual. `endsAt` es un instante absoluto y no un contador: al reanudar, lo que
 * queda se deduce del reloj, no de cuántos ticks llegaron a ejecutarse.
 */
export interface PomodoroSnapshot {
  phase: Phase;
  running: boolean;
  /** epoch ms en que vence la fase. Sólo significativo si `running`. */
  endsAt: number | null;
  /** restante congelado, en ms. Sólo significativo si no corre. */
  remainingMs: number;
  workCount: number;
  /** epoch ms del arranque del bloque de foco vivo, para `started_at`. */
  workStartedAt: number | null;
}

export interface WorkResult {
  /** minutos de foco realmente consumidos */
  minutes: number;
  /** epoch ms en que arrancó el bloque */
  startedAt: number;
  /** false = abandonado a medias; no debe puntuar */
  completed: boolean;
}

export interface PomodoroHandlers {
  onWorkEnd: (result: WorkResult) => void;
  onBreakEnd: (phase: Phase) => void;
}

function phaseMinutes(phase: Phase, config: PomodoroConfig): number {
  return phase === "work" ? config.work : phase === "short" ? config.short : config.long;
}

const phaseMs = (phase: Phase, config: PomodoroConfig) => phaseMinutes(phase, config) * 60_000;

export function freshSnapshot(config: PomodoroConfig): PomodoroSnapshot {
  return {
    phase: "work",
    running: false,
    endsAt: null,
    remainingMs: phaseMs("work", config),
    workCount: 0,
    workStartedAt: null,
  };
}

const isPhase = (v: unknown): v is Phase => v === "work" || v === "short" || v === "long";
const asInt = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;

/**
 * Sanea un snapshot recuperado del almacenamiento. Nada de lo que hay ahí es de
 * fiar: puede venir de una versión anterior, de una config distinta o de un
 * JSON a medio escribir.
 */
export function restoreSnapshot(raw: unknown, config: PomodoroConfig): PomodoroSnapshot {
  const s = raw as Partial<PomodoroSnapshot> | null | undefined;
  if (!s || !isPhase(s.phase)) return freshSnapshot(config);

  const phase = s.phase;
  const workCount = Math.max(0, asInt(s.workCount, 0));
  const full = phaseMs(phase, config);
  const workStartedAt = typeof s.workStartedAt === "number" ? s.workStartedAt : null;

  if (s.running && typeof s.endsAt === "number") {
    /* Con la app cerrada nadie vio terminar la fase. Dar por completado un
       tiempo que no se observó correr es inventar la sesión —el mismo pecado
       que registraba «Saltar»—, así que se vuelve con la fase agotada y en
       pausa, y decide el usuario. */
    if (s.endsAt <= Date.now()) {
      return { phase, running: false, endsAt: null, remainingMs: 0, workCount, workStartedAt: null };
    }
    return {
      phase,
      running: true,
      endsAt: s.endsAt,
      remainingMs: s.endsAt - Date.now(),
      workCount,
      workStartedAt,
    };
  }

  const remainingMs = Math.min(Math.max(0, asInt(s.remainingMs, full)), full);
  return { phase, running: false, endsAt: null, remainingMs, workCount, workStartedAt };
}

/** Lo que queda ahora mismo, medido contra el reloj y no contra los ticks. */
function remainingOf(t: PomodoroSnapshot): number {
  return t.running && t.endsAt != null ? Math.max(0, t.endsAt - Date.now()) : t.remainingMs;
}

/**
 * Lo que hay que registrar de un bloque de foco que se corta a medias, o `null`
 * si no hay nada que registrar.
 *
 * Pura y exportada a propósito: es la regla más delicada del módulo —«no
 * registrar tiempo que nadie vio correr»— y así se puede probar sin montar el
 * hook entero.
 *
 * Se calla en tres casos, y el tercero es el que faltaba. Una fase que venció
 * con la app cerrada vuelve agotada y sin arranque (`remainingMs: 0`,
 * `workStartedAt: null`), así que «lo consumido» salía igual a la fase entera y
 * pulsar Reiniciar o Saltar registraba una sesión abandonada de 25 minutos que
 * nadie vio correr. Es exactamente el pecado que el módulo existe para no
 * cometer, y es el mismo que ya se había arreglado en «Saltar».
 */
export function partialResult(t: PomodoroSnapshot, config: PomodoroConfig): WorkResult | null {
  if (t.phase !== "work" || t.workStartedAt == null) return null;
  const minutes = Math.floor((phaseMs("work", config) - remainingOf(t)) / 60_000);
  if (minutes < MIN_PARTIAL_MINUTES) return null;
  return { minutes, startedAt: t.workStartedAt, completed: false };
}

export function usePomodoro(
  config: PomodoroConfig,
  handlers: PomodoroHandlers,
  initial?: PomodoroSnapshot
) {
  // Los handlers viven en un ref para que su identidad no reinicie el intervalo
  // en cada render del proveedor.
  const hRef = useRef(handlers);
  hRef.current = handlers;

  const [timer, setTimerState] = useState<PomodoroSnapshot>(() => initial ?? freshSnapshot(config));
  const timerRef = useRef(timer);
  const [, forceTick] = useState(0);

  const setTimer = useCallback((next: PomodoroSnapshot) => {
    // El ref se adelanta al render a propósito: es lo que impide que dos ticks
    // seguidos vean la misma fase vencida y la cierren dos veces.
    timerRef.current = next;
    setTimerState(next);
  }, []);

  const startPhase = useCallback(
    (phase: Phase, workCount: number, now: number): PomodoroSnapshot => ({
      phase,
      running: true,
      endsAt: now + phaseMs(phase, config),
      remainingMs: phaseMs(phase, config),
      workCount,
      workStartedAt: phase === "work" ? now : null,
    }),
    [config]
  );

  /** Cierra el bloque de foco vivo como abandonado. Nunca puntúa. */
  const reportPartial = useCallback(
    (t: PomodoroSnapshot) => {
      const result = partialResult(t, config);
      if (result) hRef.current.onWorkEnd(result);
    },
    [config]
  );

  const finishPhase = useCallback(() => {
    const t = timerRef.current;
    if (!t.running) return;
    const now = Date.now();

    if (t.phase === "work") {
      const minutes = phaseMinutes("work", config);
      const startedAt = t.workStartedAt ?? (t.endsAt ?? now) - minutes * 60_000;
      const workCount = t.workCount + 1;
      const next: Phase = workCount % CYCLE_LENGTH === 0 ? "long" : "short";
      setTimer(startPhase(next, workCount, now));
      hRef.current.onWorkEnd({ minutes, startedAt, completed: true });
      return;
    }

    setTimer(startPhase("work", t.workCount, now));
    hRef.current.onBreakEnd(t.phase);
  }, [config, setTimer, startPhase]);

  // Cuenta atrás. El intervalo sólo refresca la vista y comprueba el
  // vencimiento; el tiempo lo lleva el reloj, así que perder ticks no atrasa
  // nada. 250 ms para que el segundo cambie a tiempo.
  useEffect(() => {
    if (!timer.running) return;
    const check = () => {
      if (remainingOf(timerRef.current) <= 0) finishPhase();
      else forceTick((n) => n + 1);
    };
    const id = window.setInterval(check, 250);
    /* Con la ventana oculta o minimizada el navegador estrangula los intervalos
       —de 1/s a 1/min—, así que al volver hay que resincronizar en el acto en
       vez de esperar al siguiente tick. */
    const onWake = () => check();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [timer.running, timer.endsAt, finishPhase]);

  // Cambiar la duración reinicia la fase en curso si está detenida. Compara los
  // minutos de la fase antes y después: en el primer render son los mismos, y
  // así una sesión restaurada a media fase no se machaca al montar.
  const prevConfig = useRef(config);
  useEffect(() => {
    const before = prevConfig.current;
    prevConfig.current = config;
    const t = timerRef.current;
    if (t.running) return;
    const full = phaseMs(t.phase, config);
    if (phaseMs(t.phase, before) === full) return;
    setTimer({ ...t, remainingMs: full, endsAt: null });
  }, [config, setTimer]);

  const start = useCallback(() => {
    const t = timerRef.current;
    if (t.running) return;
    const now = Date.now();
    const remaining = t.remainingMs > 0 ? t.remainingMs : phaseMs(t.phase, config);
    setTimer({
      ...t,
      running: true,
      endsAt: now + remaining,
      remainingMs: remaining,
      // Reanudar tras una pausa conserva el arranque original del bloque.
      workStartedAt: t.phase === "work" ? t.workStartedAt ?? now : null,
    });
  }, [config, setTimer]);

  const pause = useCallback(() => {
    const t = timerRef.current;
    if (!t.running) return;
    setTimer({ ...t, running: false, endsAt: null, remainingMs: remainingOf(t) });
  }, [setTimer]);

  /**
   * Abre un bloque de foco desde cero, venga de donde venga. Lo pide el botón de
   * la fila de tarea: «iniciar un pomodoro» no puede reanudar el descanso que
   * hubiera a medias, que es lo que hacía `start`. Si había foco vivo se cierra
   * como abandonado, porque cambiar de tarea es abandonarlo.
   */
  const startFocus = useCallback(() => {
    const t = timerRef.current;
    reportPartial(t);
    setTimer(startPhase("work", t.workCount, Date.now()));
  }, [reportPartial, setTimer, startPhase]);

  const reset = useCallback(() => {
    const t = timerRef.current;
    reportPartial(t);
    setTimer({
      ...t,
      running: false,
      endsAt: null,
      remainingMs: phaseMs(t.phase, config),
      workStartedAt: null,
    });
  }, [config, reportPartial, setTimer]);

  const skip = useCallback(() => {
    const t = timerRef.current;
    reportPartial(t);
    /* Saltar no completa nada: no otorga XP, no registra sesión completa y no
       avanza el ciclo, así que el descanso que sigue es siempre el corto. */
    const next: Phase = t.phase === "work" ? "short" : "work";
    setTimer({
      phase: next,
      running: false,
      endsAt: null,
      remainingMs: phaseMs(next, config),
      workCount: t.workCount,
      workStartedAt: null,
    });
  }, [config, reportPartial, setTimer]);

  const total = phaseMs(timer.phase, config);
  const left = remainingOf(timer);
  const progress = total > 0 ? 1 - left / total : 0;
  // Durante el descanso largo el ciclo está lleno, no vacío: `workCount % 4`
  // vale 0 justo cuando se acaban de completar los cuatro.
  const cycleDone = timer.phase === "long" ? CYCLE_LENGTH : timer.workCount % CYCLE_LENGTH;

  return {
    phase: timer.phase,
    secondsLeft: Math.ceil(left / 1000),
    /* El dial dibuja una marca por minuto de la fase, así que necesita la
       duración además de lo que queda. Deducirla de `progress` fallaba al
       llegar a cero, que es justo cuando la esfera tiene que estar llena. */
    totalSeconds: Math.round(total / 1000),
    running: timer.running,
    workCount: timer.workCount,
    progress,
    cycleDone,
    snapshot: timer,
    start,
    startFocus,
    pause,
    reset,
    skip,
  };
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
