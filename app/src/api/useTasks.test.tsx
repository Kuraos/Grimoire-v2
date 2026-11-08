// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { useTasks } from "./tasks";
import { useQueue } from "./queryClient";

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {} },
}));
vi.mock("@capacitor/network", () => ({
  Network: { getStatus: async () => ({ connected: false }), addListener: async () => ({ remove: async () => {} }) },
}));
vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: { get: async () => "tok", set: async () => {}, remove: async () => {} },
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* El contexto del pomodoro depende de `useTasks`: si sus listas cambian de identidad en cada render,
   el contexto cambia con cada tick del temporizador y arrastra a toda la app (2.3.5b). */
test("useTasks y useQueue conservan la identidad mientras los datos no cambian", () => {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(["tasks", "list"], []);
  const seen: { tasks: unknown; queue: unknown }[] = [];
  let bump = () => {};
  function Probe() {
    const [, set] = useState(0);
    bump = () => set((n) => n + 1);
    seen.push({ tasks: useTasks().tasks, queue: useQueue() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>));
  act(() => bump());
  act(() => bump());
  expect(seen.length).toBeGreaterThanOrEqual(3);
  for (const s of seen) {
    expect(s.tasks).toBe(seen[0].tasks);
    expect(s.queue).toBe(seen[0].queue);
  }
  act(() => root.unmount());
});
