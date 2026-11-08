// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PomodoroProvider, usePomodoroCtx } from "../pomodoro-context";
import { ConfigRow, dayStart } from "./Pomodoro";

/* El disco de verdad es `Preferences`: lo que quede aquí es lo que se lee al reabrir. */
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: disk.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { disk.set(key, value); },
  },
}));
vi.mock("@capacitor/network", () => ({
  Network: { getStatus: async () => ({ connected: false }), addListener: async () => ({ remove: async () => {} }) },
}));
vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: { get: async () => "tok", set: async () => {}, remove: async () => {} },
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("../sounds", () => ({ playChime: () => {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Work() {
  const pomo = usePomodoroCtx();
  if (!pomo) return null;
  return <ConfigRow label="Trabajo" value={pomo.config.work} onChange={(v) => pomo.setConfig({ ...pomo.config, work: v })} />;
}

let root: Root;
let input: HTMLInputElement;
beforeEach(async () => {
  disk.clear();
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(["tasks", "list"], []);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<QueryClientProvider client={qc}><PomodoroProvider><Work /></PomodoroProvider></QueryClientProvider>);
  });
  input = host.querySelector("input")!;
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

/* Un dedo no fija el valor: borra o agrega una tecla sobre lo que el campo muestra en ese momento. */
const setDom = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
async function key(next: (shown: string) => string) {
  await act(async () => {
    input.focus();
    setDom.call(input, next(input.value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const backspace = () => key((s) => s.slice(0, -1));
const type = (ch: string) => key((s) => s + ch);
async function blur() {
  await act(async () => { input.blur(); input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}
const saved = () => JSON.parse(disk.get("grimoire-pomodoro-v1")!).config.work;

test("borrar «25» y teclear «3» guarda 3 en disco", async () => {
  expect(input.value).toBe("25");
  await backspace();
  await backspace();
  await type("3");
  await blur();
  expect(input.value).toBe("3");
  expect(saved()).toBe(3);
});

test("borrar «1» y teclear «3» guarda 3; vacío o fuera de 1–90 se corrige al salir", async () => {
  await backspace();
  await backspace();
  await type("1");
  await blur();
  expect(saved()).toBe(1);
  await backspace();
  await type("3");
  await blur();
  expect(saved()).toBe(3);
  await backspace();
  await blur();
  expect([input.value, saved()]).toEqual(["3", 3]);
  await backspace();
  await type("9");
  await type("5");
  await blur();
  expect([input.value, saved()]).toEqual(["90", 90]);
  await backspace();
  await backspace();
  await type("0");
  await blur();
  expect([input.value, saved()]).toEqual(["1", 1]);
});

// 2.3.6: la recta empezaba siempre a las 06:00 y un pomodoro de las 00:02 no se veía.
test("la recta empieza a las 06:00, o en la hora entera de la primera sesión de madrugada", () => {
  const s = (iso: string) => ({ started_at: iso });
  expect(dayStart([])).toBe(6);
  expect(dayStart([s("2026-11-08T12:30:00Z"), s("2026-11-08T20:00:00Z")])).toBe(6); // 07:30 y 15:00
  expect(dayStart([s("2026-11-08T12:30:00Z"), s("2026-11-08T05:02:53Z")])).toBe(0); // 00:02, en cualquier orden
  expect(dayStart([s("2026-11-08T10:59:00Z")])).toBe(5); // 05:59
});
