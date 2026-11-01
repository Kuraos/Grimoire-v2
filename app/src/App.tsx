import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { App as CapApp } from "@capacitor/app";
import { Sidebar } from "./components/layout/Sidebar";
import { BottomNav } from "./components/layout/BottomNav";
import { TopBar } from "./components/layout/TopBar";
import { CommandPalette, type CommandPalettePomodoro } from "./components/layout/CommandPalette";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { PageHeader } from "./components/layout/PageHeader";
import { useIsDesktop } from "./hooks/useMediaQuery";
import { motionTokens } from "./theme-tokens";
import Habits from "./pages/Habits";
import Tasks from "./pages/Tasks";
import { useApp } from "./context";
import { ConfirmHost } from "./confirm";
import { ToastAchievement } from "./components/layout/ToastAchievement";
import { LevelUpOverlay } from "./components/layout/LevelUpOverlay";

/* Entrada de cada vista, como en la v1: solo opacidad, sin transform (ver Modal.tsx). */
function viewEnter() {
  const t = motionTokens();
  return {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: t.state, staggerChildren: 0.04 } },
  };
}

// TODO(fase-2): estado real del Pomodoro (pomodoro-context no se portó).
const SIN_POMODORO: CommandPalettePomodoro = { running: false, start: () => {}, pause: () => {}, tasks: [], startWithTask: () => {} };
// TODO(fase-N): Ajustes se rehace (SettingsModal de la v1 no se portó).
const abrirAjustes = () => {};

/** Vista que todavía no se porta: deja la ruta navegable. */
function Pendiente({ titulo }: { titulo: string }) {
  return (
    <PageHeader title={titulo} context="se porta en una fase siguiente" />
  );
}

const PENDIENTES: [string, string][] = [
  ["/", "Inicio"], ["/pomodoro", "Pomodoro"], ["/calendario", "Calendario"],
  ["/diario", "Diario"], ["/entrenamiento", "Entrenamiento"], ["/erario", "Erario"],
  ["/estadisticas", "Estadísticas"], ["/logros", "Logros"], ["/revision", "Revisión semanal"],
];

export default function App() {
  const location = useLocation();
  const desktop = useIsDesktop();
  const { user, toasts, dismissToast, levelUp, dismissLevelUp } = useApp();

  // Atrás de Android: primero cierra la hoja o el modal abierto, después navega.
  useEffect(() => {
    const handle = CapApp.addListener("backButton", ({ canGoBack }) => {
      // el fondo de todo diálogo (Overlay) cierra al tocarlo: se reutiliza ese camino
      const overlay = document.querySelector<HTMLElement>("[data-overlay]");
      if (overlay) overlay.click();
      else if (canGoBack) window.history.back();
      else CapApp.exitApp();
    });
    return () => { handle.then((h) => h.remove()); };
  }, []);

  return (
    <div className="gr-cielo flex h-dvh overflow-hidden">
      <div className="hidden lg:flex"><Sidebar /></div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* El borde superior (barra de estado, cámara) se pinta del color del cromo */}
        <div style={{ paddingTop: "env(safe-area-inset-top)", background: "var(--gr-chrome)" }}>
          <TopBar user={user} onOpenSettings={abrirAjustes} />
        </div>
        <main className="flex-1 overflow-y-auto p-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-4">
          <ErrorBoundary key={location.pathname} scope={location.pathname}>
            <motion.div key={location.pathname} initial="hidden" animate="show" variants={viewEnter()}>
              <Routes>
                {PENDIENTES.map(([path, titulo]) => (
                  <Route key={path} path={path} element={<Pendiente titulo={titulo} />} />
                ))}
                <Route path="/habitos" element={<Habits />} />
                <Route path="/tareas" element={<Tasks />} />
              </Routes>
            </motion.div>
          </ErrorBoundary>
        </main>
      </div>
      <BottomNav onOpenSettings={abrirAjustes} />
      {/* Solo con teclado físico: en teléfono no se muestra ni se reemplaza */}
      {desktop && <CommandPalette pomo={SIN_POMODORO} />}
      <ToastAchievement toasts={toasts} dismissToast={dismissToast} />
      <LevelUpOverlay levelUp={levelUp} dismissLevelUp={dismissLevelUp} />
      <ConfirmHost />
    </div>
  );
}
