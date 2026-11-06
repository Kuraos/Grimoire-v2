import { describe, it, expect } from "vitest";
import {
  restoreSnapshot, freshSnapshot, partialResult, closePhase, startTimer, pauseTimer, resetTimer,
  skipPhase, startFocusTimer, applyConfig, restoreConfig, DEFAULT_CONFIG, LATE_LIMIT_MS,
  type PomodoroSnapshot,
} from "./usePomodoro";

const NOW = Date.parse("2026-03-02T17:00:00Z");
const MIN = 60_000;
const C = DEFAULT_CONFIG;

const stored = (over: Partial<PomodoroSnapshot>): PomodoroSnapshot => ({
  phase: "work",
  running: false,
  endsAt: null,
  remainingMs: C.work * MIN,
  workCount: 0,
  workStartedAt: null,
  minutes: C.work,
  sessionId: null,
  ...over,
});

/** Un bloque de 25 min arrancado a `start` y corriendo. */
const block = (start: number, over: Partial<PomodoroSnapshot> = {}) =>
  stored({ running: true, endsAt: start + 25 * MIN, workStartedAt: start, sessionId: "s1", ...over });

describe("restoreSnapshot", () => {
  it("falls back to a fresh timer when there is nothing usable", () => {
    for (const raw of [null, undefined, { phase: "siesta" }]) {
      expect(restoreSnapshot(raw, C, NOW)).toEqual({ next: freshSnapshot(C), closed: null });
    }
  });

  it("keeps a running timer and measures the remainder against the clock", () => {
    const { next, closed } = restoreSnapshot(stored({ running: true, endsAt: NOW + 5 * MIN, remainingMs: 0, workCount: 2, sessionId: "s1", workStartedAt: NOW - 20 * MIN }), C, NOW);
    expect(closed).toBeNull();
    expect(next).toMatchObject({ running: true, workCount: 2, remainingMs: 5 * MIN, sessionId: "s1" });
  });

  it("clamps a stored remainder to the length of its phase", () => {
    const { next } = restoreSnapshot(stored({ phase: "short", minutes: 5, remainingMs: 99 * MIN }), C, NOW);
    expect(next.remainingMs).toBe(5 * MIN);
  });

  it("survives a snapshot with junk in it", () => {
    const { next } = restoreSnapshot(
      { phase: "long", running: false, remainingMs: "cinco", workCount: -3, workStartedAt: {}, sessionId: 7 },
      C, NOW
    );
    expect(next).toMatchObject({ remainingMs: C.long * MIN, workCount: 0, workStartedAt: null, sessionId: null, minutes: C.long });
  });

  it("restoreConfig keeps the 1–90 limits", () => {
    expect(restoreConfig({ work: 0, short: 200, long: "x" })).toEqual({ work: 1, short: 90, long: 15 });
    expect(restoreConfig(null)).toEqual(C);
  });
});

describe("cierre de un bloque vencido · decisión 2", () => {
  // Fila 26: la v1 volvía agotada y en pausa y no registraba nada. La v2 lo registra con su hora real.
  it("vencido con la app cerrada se registra completo, con finished_at = endsAt (filas 25 y 26)", () => {
    const start = NOW - 60 * MIN;
    const { next, closed } = restoreSnapshot(block(start, { workCount: 1 }), C, NOW);
    expect(closed).toEqual({ sessionId: "s1", minutes: 25, startedAt: start, finishedAt: start + 25 * MIN, completed: true });
    // venció hace más de 5 s: el descanso queda listo y en pausa, sin arrancar solo
    expect(next).toMatchObject({ phase: "short", running: false, remainingMs: C.short * MIN, workCount: 2, sessionId: null });
  });

  it("borde de 12 h: justo 12 h, completo; un instante después, incompleto y sin avanzar el ciclo (fila 34)", () => {
    const endsAt = NOW - LATE_LIMIT_MS;
    const t = block(endsAt - 25 * MIN, { workCount: 1 });
    expect(restoreSnapshot(t, C, NOW).closed).toMatchObject({ completed: true, finishedAt: endsAt, minutes: 25 });
    const late = restoreSnapshot(t, C, NOW + 1);
    expect(late.closed).toMatchObject({ completed: false, finishedAt: endsAt, minutes: 25, sessionId: "s1" });
    expect(late.next).toMatchObject({ phase: "work", running: false, workCount: 1, sessionId: null });
  });

  it("en un tick a tiempo, el descanso arranca solo como en la v1", () => {
    const t = block(NOW - 25 * MIN);
    const { next, closed } = closePhase(t, NOW + 5_000, C);
    expect(closed?.completed).toBe(true);
    expect(next).toMatchObject({ phase: "short", running: true, endsAt: NOW + 5_000 + C.short * MIN });
  });

  it("congelada más de 5 s, no encadena: queda lista y en pausa", () => {
    const { next } = closePhase(block(NOW - 25 * MIN), NOW + 5_001, C);
    expect(next).toMatchObject({ phase: "short", running: false });
  });

  it("el cuarto bloque da descanso largo", () => {
    expect(closePhase(block(NOW - 25 * MIN, { workCount: 3 }), NOW, C).next.phase).toBe("long");
  });

  it("un descanso vencido no registra nada y deja el foco listo y en pausa, sin id", () => {
    const brk = stored({ phase: "short", minutes: 5, running: true, endsAt: NOW - MIN, workCount: 1 });
    const { next, closed } = restoreSnapshot(brk, C, NOW);
    expect(closed).toBeNull();
    expect(next).toMatchObject({ phase: "work", running: false, sessionId: null, workCount: 1 });
    // y un segundo cierre no encadena nada más
    expect(closePhase(next, NOW + 60 * MIN, C)).toEqual({ next, closed: null });
  });

  it("un descanso que vence a tiempo abre un bloque nuevo con id nuevo", () => {
    const brk = stored({ phase: "short", minutes: 5, running: true, endsAt: NOW, workCount: 1 });
    const { next } = closePhase(brk, NOW + 1_000, C);
    expect(next).toMatchObject({ phase: "work", running: true, workStartedAt: NOW + 1_000 });
    expect(next.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reiniciar la app antes de vencer: sigue corriendo y no registra", () => {
    const t = block(NOW - 10 * MIN);
    const first = restoreSnapshot(t, C, NOW);
    const second = restoreSnapshot(first.next, C, NOW + MIN);
    expect([first.closed, second.closed]).toEqual([null, null]);
    expect(second.next).toMatchObject({ running: true, endsAt: t.endsAt, sessionId: "s1" });
  });

  it("restaurar dos veces el mismo estado vencido da la misma sesión, con el mismo id", () => {
    const t = block(NOW - 60 * MIN);
    expect(restoreSnapshot(t, C, NOW).closed).toEqual(restoreSnapshot(t, C, NOW + 3 * MIN).closed);
  });
});

describe("transiciones a mano", () => {
  it("empezar da un id; pausar y reanudar lo conservan, con el ends_at nuevo", () => {
    const run = startTimer(freshSnapshot(C), NOW, C);
    expect(run.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const paused = pauseTimer(run, NOW + 10 * MIN);
    expect(paused).toMatchObject({ running: false, endsAt: null, remainingMs: 15 * MIN, sessionId: run.sessionId });
    const resumed = startTimer(paused, NOW + 30 * MIN, C);
    expect(resumed).toMatchObject({ running: true, endsAt: NOW + 45 * MIN, workStartedAt: NOW, sessionId: run.sessionId });
  });

  it("abandonar registra lo consumido, incompleto, con el id del bloque", () => {
    const t = block(NOW - 8 * MIN);
    for (const tr of [resetTimer(t, NOW, C), skipPhase(t, NOW, C), startFocusTimer(t, NOW, C)]) {
      expect(tr.closed).toEqual({ sessionId: "s1", minutes: 8, startedAt: NOW - 8 * MIN, finishedAt: NOW, completed: false });
    }
    expect(resetTimer(t, NOW, C).next).toMatchObject({ running: false, sessionId: null, remainingMs: 25 * MIN });
    expect(skipPhase(t, NOW, C).next).toMatchObject({ phase: "short", running: false, workCount: 0 });
    const fresh = startFocusTimer(t, NOW, C).next;
    expect(fresh.running).toBe(true);
    expect(fresh.sessionId).not.toBe("s1");
  });

  it("menos de un minuto no registra; un minuto justo sí", () => {
    expect(partialResult(block(NOW - 59_999), NOW)).toBeNull();
    expect(partialResult(block(NOW - MIN), NOW)?.minutes).toBe(1);
  });

  it("fuera de un bloque empezado no hay nada que abandonar", () => {
    expect(partialResult(stored({ phase: "short", minutes: 5, workStartedAt: NOW, remainingMs: 0 }), NOW)).toBeNull();
    expect(partialResult(freshSnapshot(C), NOW)).toBeNull();
  });

  it("cambiar la configuración a media sesión no altera sus minutos (decisión 8)", () => {
    const t = block(NOW - 5 * MIN);
    const other = { ...C, work: 50 };
    expect(applyConfig(t, other)).toBe(t);
    const paused = pauseTimer(t, NOW);
    expect(applyConfig(paused, other)).toBe(paused);
    // al vencer se registran los 25 con los que empezó
    expect(closePhase(t, t.endsAt!, other).closed?.minutes).toBe(25);
    expect(partialResult(paused, NOW)?.minutes).toBe(5);
    // una fase sin empezar sí toma la duración nueva
    expect(applyConfig(freshSnapshot(C), other)).toMatchObject({ minutes: 50, remainingMs: 50 * MIN });
  });
});
