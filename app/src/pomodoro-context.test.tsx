// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PomodoroProvider, usePomodoroClock, usePomodoroCtx } from "./pomodoro-context";
import { freshSnapshot, DEFAULT_CONFIG } from "./hooks/usePomodoro";
import App from "./App";

/* Cuántas veces se dibuja cada lector. Lo comparten los mocks, así que va en `vi.hoisted`. */
const renders = vi.hoisted(() => ({ stable: 0, clock: 0, route: 0, island: 0 }));

vi.mock("./api/pomodoro", () => ({
  bootPomodoro: async () => ({
    config: DEFAULT_CONFIG,
    links: { taskId: null, projectId: null },
    timer: freshSnapshot(DEFAULT_CONFIG),
    notice: "scheduled",
  }),
  savePomodoro: async () => "scheduled",
  recordSession: async () => {},
  sessionRequests: { create: () => ({}) },
}));
vi.mock("./api/tasks", () => {
  const tasks: never[] = [];
  return { useTasks: () => ({ tasks }) };
});
vi.mock("./sounds", () => ({ playChime: () => {} }));

// `App` sin sus vecinos pesados: las rutas y la isla son contadores; lo demás no pinta nada.
vi.mock("./pages/Tasks", () => ({ default: () => { renders.route++; return null; } }));
vi.mock("./pages/Habits", () => ({ default: () => null }));
vi.mock("./pages/Pomodoro", () => ({ default: () => null }));
vi.mock("./components/layout/PomodoroIsland", () => ({
  PomodoroIsland: () => { renders.island++; return null; },
}));
vi.mock("./components/layout/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./components/layout/BottomNav", () => ({ BottomNav: () => null }));
vi.mock("./components/layout/TopBar", () => ({ TopBar: () => null }));
vi.mock("./components/layout/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("./components/layout/ToastAchievement", () => ({ ToastAchievement: () => null }));
vi.mock("./components/layout/LevelUpOverlay", () => ({ LevelUpOverlay: () => null }));
vi.mock("./reminders", () => ({ TaskReminders: () => null }));
vi.mock("./confirm", () => ({ ConfirmHost: () => null }));
vi.mock("./hooks/useMediaQuery", () => ({ useIsDesktop: () => false }));
vi.mock("./context", () => ({
  useApp: () => ({ user: null, toasts: [], dismissToast: () => {}, levelUp: null, dismissLevelUp: () => {} }),
}));
// La animación de entrada usa WAAPI, que happy-dom cancela con rechazos sin manejar.
vi.mock("motion/react", () => ({
  motion: { div: ({ children }: { children?: ReactNode }) => children },
}));
vi.mock("@capacitor/app", () => ({
  App: { addListener: () => Promise.resolve({ remove: () => {} }), exitApp: () => {} },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof usePomodoroCtx> = null;

function StableReader() {
  renders.stable++;
  api = usePomodoroCtx();
  return null;
}
function ClockReader() {
  renders.clock++;
  usePomodoroClock();
  return null;
}

let root: Root;
beforeEach(async () => {
  vi.useFakeTimers();
  api = null;
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/tareas"]}>
        <PomodoroProvider>
          <StableReader />
          <ClockReader />
          <App />
        </PomodoroProvider>
      </MemoryRouter>,
    );
  });
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Arranca el foco y avanza 5 s simulados, contando desde después del arranque. */
function run5s() {
  expect(api).not.toBeNull();
  act(() => api!.start());
  for (const k of Object.keys(renders) as (keyof typeof renders)[]) renders[k] = 0;
  // Un `act` por tick del intervalo: uno solo para los 5 s agruparía todos los setState en un render.
  for (let i = 0; i < 20; i++) act(() => { vi.advanceTimersByTime(250); });
}

test("mientras se restaura, los dos contextos valen null", () => {
  let seen: unknown[] = [];
  function Probe() { seen = [usePomodoroCtx(), usePomodoroClock()]; return null; }
  const r = createRoot(document.createElement("div"));
  // Sin esperar a `bootPomodoro`: el primer render es antes de restaurar.
  act(() => r.render(<PomodoroProvider><Probe /></PomodoroProvider>));
  expect(seen).toEqual([null, null]);
  act(() => r.unmount());
});

test("un lector del contexto estable no se redibuja con el temporizador corriendo", () => {
  run5s();
  expect(renders.stable).toBe(0);
});

test("el lector del reloj se redibuja una vez por segundo, no cuatro", () => {
  run5s();
  // 5 s: un render por segundo mostrado, con tolerancia de uno por el borde del primer segundo.
  expect(renders.clock).toBeGreaterThanOrEqual(4);
  expect(renders.clock).toBeLessThanOrEqual(6);
});

test("en /tareas la ruta no se redibuja y la isla sigue el segundo", () => {
  run5s();
  expect(renders.route).toBe(0);
  expect(renders.island).toBeGreaterThanOrEqual(4);
  expect(renders.island).toBeLessThanOrEqual(6);
});

test("el atajo de Espacio no se re-suscribe en cada tick", () => {
  expect(api).not.toBeNull();
  act(() => api!.start());
  const add = vi.spyOn(window, "addEventListener");
  for (let i = 0; i < 20; i++) act(() => { vi.advanceTimersByTime(250); });
  expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
});

test("Espacio sigue pausando y reanudando", async () => {
  expect(api!.running).toBe(false);
  // `async`: cada cambio guarda en disco y el aviso vuelve en una promesa.
  const space = () => act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true })); });
  await space();
  expect(api!.running).toBe(true);
  await space();
  expect(api!.running).toBe(false);
});
