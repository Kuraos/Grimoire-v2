import { describe, it, expect } from "vitest";
import {
  restoreSnapshot, freshSnapshot, partialResult, DEFAULT_CONFIG, type PomodoroSnapshot,
} from "./usePomodoro";

const stored = (over: Partial<PomodoroSnapshot>): PomodoroSnapshot => ({
  phase: "work",
  running: false,
  endsAt: null,
  remainingMs: DEFAULT_CONFIG.work * 60_000,
  workCount: 0,
  workStartedAt: null,
  ...over,
});

describe("restoreSnapshot", () => {
  it("falls back to a fresh timer when there is nothing usable", () => {
    expect(restoreSnapshot(null, DEFAULT_CONFIG)).toEqual(freshSnapshot(DEFAULT_CONFIG));
    expect(restoreSnapshot(undefined, DEFAULT_CONFIG)).toEqual(freshSnapshot(DEFAULT_CONFIG));
    expect(restoreSnapshot({ phase: "siesta" }, DEFAULT_CONFIG)).toEqual(freshSnapshot(DEFAULT_CONFIG));
  });

  it("keeps a running timer and measures the remainder against the clock", () => {
    const endsAt = Date.now() + 5 * 60_000;
    const s = restoreSnapshot(stored({ running: true, endsAt, remainingMs: 0, workCount: 2 }), DEFAULT_CONFIG);
    expect(s.running).toBe(true);
    expect(s.workCount).toBe(2);
    // el restante sale del reloj, no del valor guardado (que era 0)
    expect(s.remainingMs).toBeGreaterThan(4 * 60_000);
    expect(s.remainingMs).toBeLessThanOrEqual(5 * 60_000);
  });

  it("never resurrects a phase that expired while the app was closed", () => {
    const s = restoreSnapshot(
      stored({ running: true, endsAt: Date.now() - 60_000, remainingMs: 0, workCount: 1 }),
      DEFAULT_CONFIG
    );
    // Nadie observó ese final: se vuelve agotado y en pausa, sin registrar nada.
    expect(s.running).toBe(false);
    expect(s.remainingMs).toBe(0);
    expect(s.workCount).toBe(1);
  });

  it("clamps a stored remainder to the length of its phase", () => {
    const s = restoreSnapshot(stored({ phase: "short", remainingMs: 99 * 60_000 }), DEFAULT_CONFIG);
    expect(s.remainingMs).toBe(DEFAULT_CONFIG.short * 60_000);
  });

  it("survives a snapshot with junk in it", () => {
    const s = restoreSnapshot(
      { phase: "long", running: false, remainingMs: "cinco", workCount: -3, workStartedAt: {} },
      DEFAULT_CONFIG
    );
    expect(s.remainingMs).toBe(DEFAULT_CONFIG.long * 60_000);
    expect(s.workCount).toBe(0);
    expect(s.workStartedAt).toBeNull();
  });
});

describe("partialResult · no registrar tiempo que nadie vio correr", () => {
  it("no inventa una sesión con la fase que venció con la app cerrada", () => {
    // vuelve agotada y sin arranque; «lo consumido» daba la fase entera, así que
    // Reiniciar o Saltar registraban 25 minutos que nadie vio correr
    const vencida = restoreSnapshot(
      stored({ running: true, endsAt: Date.now() - 60_000, workCount: 1 }),
      DEFAULT_CONFIG
    );
    expect(vencida.workStartedAt).toBeNull();
    expect(partialResult(vencida, DEFAULT_CONFIG)).toBeNull();
  });

  it("registra lo consumido de un bloque cortado a medias", () => {
    const startedAt = Date.now() - 8 * 60_000;
    const t = stored({ workStartedAt: startedAt, remainingMs: (DEFAULT_CONFIG.work - 8) * 60_000 });
    expect(partialResult(t, DEFAULT_CONFIG)).toEqual({ minutes: 8, startedAt, completed: false });
  });

  it("se calla por debajo del minuto y fuera de una fase de foco", () => {
    const casi = stored({
      workStartedAt: Date.now(),
      remainingMs: DEFAULT_CONFIG.work * 60_000 - 30_000,
    });
    expect(partialResult(casi, DEFAULT_CONFIG)).toBeNull();

    const descanso = stored({ phase: "short", workStartedAt: Date.now(), remainingMs: 0 });
    expect(partialResult(descanso, DEFAULT_CONFIG)).toBeNull();
  });
});
