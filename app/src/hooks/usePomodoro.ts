import { useCallback, useEffect, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";

export type Phase = "work" | "short" | "long";

export interface PomodoroConfig {
  work: number; // minutes
  short: number;
  long: number;
}

export const DEFAULT_CONFIG: PomodoroConfig = { work: 25, short: 5, long: 15 };

/** Un ciclo son cuatro bloques de foco; el cuarto da descanso largo. */
export const CYCLE_LENGTH = 4;

/** Por debajo de un minuto no hay foco que registrar, sólo ruido (decisión 8). */
const MIN_PARTIAL_MINUTES = 1;

/** Más tarde que esto, la fase vencida no encadena la siguiente: queda lista y en pausa (decisión 2). */
export const CHAIN_GRACE_MS = 5_000;

/** Un bloque vencido detectado hasta 12 h después, 12 h justas incluidas, se registra completo
 *  (decisión 2, fila 34). Después, incompleto y sin XP. */
export const LATE_LIMIT_MS = 12 * 3_600_000;

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
  /** Minutos de la fase, fijados al empezarla: cambiar la configuración no altera lo registrado
   *  (decisión 8). */
  minutes: number;
  /** Id de la sesión del bloque de foco vivo. Nace al empezar el bloque y viaja en el `POST`, así
   *  que registrar dos veces el mismo bloque no duplica (fila 27). `null` fuera de un bloque. */
  sessionId: string | null;
}

export interface WorkResult {
  sessionId: string;
  /** minutos de foco: la duración del bloque, o lo consumido si se abandonó */
  minutes: number;
  /** epoch ms en que arrancó el bloque */
  startedAt: number;
  /** epoch ms en que terminó: `endsAt` del bloque, no cuándo se detectó (fila 25) */
  finishedAt: number;
  /** false = abandonado o detectado tarde; no puntúa */
  completed: boolean;
}

export interface PomodoroHandlers {
  onWorkEnd: (result: WorkResult) => void;
  onBreakEnd: (phase: Phase) => void;
}

/** El siguiente estado y, si lo hay, el bloque de foco que se cerró y hay que registrar. */
export interface Transition {
  next: PomodoroSnapshot;
  closed: WorkResult | null;
}

export function phaseMinutes(phase: Phase, config: PomodoroConfig): number {
  return phase === "work" ? config.work : phase === "short" ? config.short : config.long;
}

/** La fase lista para arrancar, en pausa y entera. */
function idle(phase: Phase, workCount: number, config: PomodoroConfig): PomodoroSnapshot {
  const minutes = phaseMinutes(phase, config);
  return {
    phase,
    running: false,
    endsAt: null,
    remainingMs: minutes * 60_000,
    workCount,
    workStartedAt: null,
    minutes,
    sessionId: null,
  };
}

export const freshSnapshot = (config: PomodoroConfig) => idle("work", 0, config);

/** La fase corriendo desde `now`. Un bloque de foco nace con su id. */
function running(phase: Phase, workCount: number, now: number, config: PomodoroConfig): PomodoroSnapshot {
  const minutes = phaseMinutes(phase, config);
  return {
    phase,
    running: true,
    endsAt: now + minutes * 60_000,
    remainingMs: minutes * 60_000,
    workCount,
    workStartedAt: phase === "work" ? now : null,
    minutes,
    sessionId: phase === "work" ? uuidv7() : null,
  };
}

/** Lo que queda en `now`, medido contra el reloj y no contra los ticks. */
export function remainingAt(t: PomodoroSnapshot, now: number): number {
  return t.running && t.endsAt != null ? Math.max(0, t.endsAt - now) : t.remainingMs;
}

/**
 * Lo que hay que registrar de un bloque de foco que se corta a medias, o `null`
 * si no hay nada que registrar: fuera de un bloque empezado o por debajo del minuto.
 * Una abandonada se registra, pero no puntúa.
 */
export function partialResult(t: PomodoroSnapshot, now: number): WorkResult | null {
  if (t.phase !== "work" || t.workStartedAt == null || t.sessionId == null) return null;
  const minutes = Math.floor((t.minutes * 60_000 - remainingAt(t, now)) / 60_000);
  if (minutes < MIN_PARTIAL_MINUTES) return null;
  return { sessionId: t.sessionId, minutes, startedAt: t.workStartedAt, finishedAt: now, completed: false };
}

// ---------- Transiciones: funciones puras del estado y del reloj ----------

/**
 * Cierra la fase vencida (decisión 2). Sirve igual al abrir la app que en un tick: lo que decide es
 * cuánto hace que venció, no quién lo detectó.
 *
 * - Un bloque de foco se registra con `finished_at` = `endsAt`. Detectado hasta 12 h después,
 *   completo; más tarde, incompleto y sin XP, como uno abandonado, y el ciclo no avanza.
 * - Un descanso no registra nada.
 * - Si venció hace más de 5 s, nada arranca solo: lo siguiente queda listo y en pausa. Así no corre
 *   nada que nadie ve, y no se encadenan descansos fantasma.
 */
export function closePhase(t: PomodoroSnapshot, now: number, config: PomodoroConfig): Transition {
  if (!t.running || t.endsAt == null || t.endsAt > now) return { next: t, closed: null };
  const late = now - t.endsAt;
  const chain = late <= CHAIN_GRACE_MS;

  if (t.phase !== "work") {
    return { next: chain ? running("work", t.workCount, now, config) : idle("work", t.workCount, config), closed: null };
  }
  const closed: WorkResult | null = t.sessionId == null ? null : {
    sessionId: t.sessionId,
    minutes: t.minutes,
    startedAt: t.workStartedAt ?? t.endsAt - t.minutes * 60_000,
    finishedAt: t.endsAt,
    completed: late <= LATE_LIMIT_MS,
  };
  if (closed && !closed.completed) return { next: idle("work", t.workCount, config), closed };
  const workCount = t.workCount + 1;
  const next: Phase = workCount % CYCLE_LENGTH === 0 ? "long" : "short";
  return { next: chain ? running(next, workCount, now, config) : idle(next, workCount, config), closed };
}

/** Arranca o reanuda. Reanudar conserva el id, el arranque y los minutos del bloque. */
export function startTimer(t: PomodoroSnapshot, now: number, config: PomodoroConfig): PomodoroSnapshot {
  if (t.running) return t;
  if (t.remainingMs <= 0) return running(t.phase, t.workCount, now, config);
  const work = t.phase === "work";
  return {
    ...t,
    running: true,
    endsAt: now + t.remainingMs,
    workStartedAt: work ? t.workStartedAt ?? now : null,
    sessionId: work ? t.sessionId ?? uuidv7() : null,
  };
}

export function pauseTimer(t: PomodoroSnapshot, now: number): PomodoroSnapshot {
  if (!t.running) return t;
  return { ...t, running: false, endsAt: null, remainingMs: remainingAt(t, now) };
}

/** Vuelve la fase al principio. Un bloque empezado se cierra como abandonado. */
export function resetTimer(t: PomodoroSnapshot, now: number, config: PomodoroConfig): Transition {
  return { next: idle(t.phase, t.workCount, config), closed: partialResult(t, now) };
}

/**
 * Saltar no completa nada: no otorga XP, no registra sesión completa y no
 * avanza el ciclo, así que el descanso que sigue es siempre el corto.
 */
export function skipPhase(t: PomodoroSnapshot, now: number, config: PomodoroConfig): Transition {
  return { next: idle(t.phase === "work" ? "short" : "work", t.workCount, config), closed: partialResult(t, now) };
}

/**
 * Abre un bloque de foco desde cero, venga de donde venga. Lo pide el botón de
 * la fila de tarea: «iniciar un pomodoro» no puede reanudar el descanso que
 * hubiera a medias. Si había foco vivo se cierra como abandonado, porque cambiar
 * de tarea es abandonarlo.
 */
export function startFocusTimer(t: PomodoroSnapshot, now: number, config: PomodoroConfig): Transition {
  return { next: running("work", t.workCount, now, config), closed: partialResult(t, now) };
}

/**
 * Cambiar la duración solo toca una fase que no ha empezado. La que corre, o la que está en pausa a
 * medias, conserva sus minutos (decisión 8).
 */
export function applyConfig(t: PomodoroSnapshot, config: PomodoroConfig): PomodoroSnapshot {
  const untouched = !t.running && t.remainingMs === t.minutes * 60_000 && t.workStartedAt == null;
  const minutes = phaseMinutes(t.phase, config);
  if (!untouched || minutes === t.minutes) return t;
  return { ...t, minutes, remainingMs: minutes * 60_000 };
}

// ---------- Restaurar ----------

const isPhase = (v: unknown): v is Phase => v === "work" || v === "short" || v === "long";
const asInt = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;

/** Los mismos límites que acepta el formulario (y la API): nada de restaurar un 0 o un NaN. */
export function restoreConfig(raw: unknown): PomodoroConfig {
  const c = raw as Partial<PomodoroConfig> | null | undefined;
  const step = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(90, Math.max(1, Math.trunc(v))) : fallback;
  return {
    work: step(c?.work, DEFAULT_CONFIG.work),
    short: step(c?.short, DEFAULT_CONFIG.short),
    long: step(c?.long, DEFAULT_CONFIG.long),
  };
}

/**
 * Sanea un snapshot recuperado del almacenamiento y cierra lo que venció con la app cerrada.
 *
 * La v1 volvía con la fase agotada y en pausa y no registraba nada: «nadie la vio terminar». La v2
 * la registra con su hora real (decisión 2; caracterizacion-v1.md, filas 26 y 34), con la misma
 * regla que un tick: `closePhase`. Un bloque sin id no se registra: no hay de dónde sacar uno que
 * no duplique.
 */
export function restoreSnapshot(raw: unknown, config: PomodoroConfig, now: number): Transition {
  const s = raw as Partial<PomodoroSnapshot> | null | undefined;
  if (!s || !isPhase(s.phase)) return { next: freshSnapshot(config), closed: null };

  const phase = s.phase;
  const minutes = Math.min(90, Math.max(1, asInt(s.minutes, phaseMinutes(phase, config))));
  const full = minutes * 60_000;
  const t: PomodoroSnapshot = {
    phase,
    running: s.running === true && typeof s.endsAt === "number",
    endsAt: typeof s.endsAt === "number" ? s.endsAt : null,
    remainingMs: Math.min(Math.max(0, asInt(s.remainingMs, full)), full),
    workCount: Math.max(0, asInt(s.workCount, 0)),
    workStartedAt: phase === "work" && typeof s.workStartedAt === "number" ? s.workStartedAt : null,
    minutes,
    sessionId: phase === "work" && typeof s.sessionId === "string" ? s.sessionId : null,
  };
  if (!t.running) return { next: { ...t, endsAt: null }, closed: null };
  if (t.endsAt! <= now) return closePhase(t, now, config);
  return { next: { ...t, remainingMs: t.endsAt! - now }, closed: null };
}

// ---------- El hook ----------

/**
 * Aplica una transición: **primero** registra el bloque cerrado y **después** cambia el estado.
 * `recordSession` entra así en la fila de disco antes que el `savePomodoro` del estado nuevo, que ya
 * no tiene el `sessionId`; al revés, un crash en ese hueco perdería la sesión. El orden no depende
 * de cómo guarde la vista: sincrónico al cambiar o en un efecto, da igual.
 */
export function commitTransition(
  tr: Transition,
  setTimer: (next: PomodoroSnapshot) => void,
  onWorkEnd: (result: WorkResult) => void,
): void {
  if (tr.closed) onWorkEnd(tr.closed);
  setTimer(tr.next);
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

  const apply = useCallback((tr: Transition) => {
    commitTransition(tr, setTimer, (r) => hRef.current.onWorkEnd(r));
  }, [setTimer]);

  const finishPhase = useCallback(() => {
    const t = timerRef.current;
    const tr = closePhase(t, Date.now(), config);
    if (tr.next === t) return;
    apply(tr);
    if (t.phase !== "work") hRef.current.onBreakEnd(t.phase);
  }, [config, apply]);

  // Cuenta atrás. El intervalo sólo refresca la vista y comprueba el
  // vencimiento; el tiempo lo lleva el reloj, así que perder ticks no atrasa
  // nada. 250 ms para que el segundo cambie a tiempo, pero solo se redibuja cuando cambia el
  // segundo mostrado: redibujar en cada check eran 4 renders por segundo sin nada nuevo que pintar.
  useEffect(() => {
    if (!timer.running) return;
    let shown = Math.ceil(remainingAt(timerRef.current, Date.now()) / 1000);
    const check = () => {
      const left = remainingAt(timerRef.current, Date.now());
      if (left <= 0) return finishPhase();
      const secs = Math.ceil(left / 1000);
      if (secs !== shown) {
        shown = secs;
        forceTick((n) => n + 1);
      }
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

  useEffect(() => {
    const t = timerRef.current;
    const next = applyConfig(t, config);
    if (next !== t) setTimer(next);
  }, [config, setTimer]);

  /** Reemplaza el estado por el restaurado de disco (`bootPomodoro`), que ya cerró lo vencido. */
  const load = useCallback((t: PomodoroSnapshot) => setTimer(t), [setTimer]);
  const start = useCallback(() => setTimer(startTimer(timerRef.current, Date.now(), config)), [config, setTimer]);
  const pause = useCallback(() => setTimer(pauseTimer(timerRef.current, Date.now())), [setTimer]);
  const startFocus = useCallback(() => apply(startFocusTimer(timerRef.current, Date.now(), config)), [config, apply]);
  const reset = useCallback(() => apply(resetTimer(timerRef.current, Date.now(), config)), [config, apply]);
  const skip = useCallback(() => apply(skipPhase(timerRef.current, Date.now(), config)), [config, apply]);

  const total = timer.minutes * 60_000;
  const left = remainingAt(timer, Date.now());
  const progress = total > 0 ? 1 - left / total : 0;
  // Durante el descanso largo el ciclo está lleno, no vacío: `workCount % 4`
  // vale 0 justo cuando se acaban de completar los cuatro.
  const cycleDone = timer.phase === "long" ? CYCLE_LENGTH : timer.workCount % CYCLE_LENGTH;

  return {
    phase: timer.phase,
    secondsLeft: Math.ceil(left / 1000),
    /* El dial dibuja una marca por minuto de la fase, así que necesita la
       duración además de lo que queda. */
    totalSeconds: Math.round(total / 1000),
    running: timer.running,
    workCount: timer.workCount,
    progress,
    cycleDone,
    snapshot: timer,
    load,
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
