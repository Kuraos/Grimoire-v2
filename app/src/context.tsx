import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { onApiError, onSyncResults } from "./api/queryClient";
import { eventToast, summarizeResults, unseenEvents, useUser } from "./api/user";
import { playLevelUp } from "./sounds";
import { burstFromLastPress } from "./burst";
import type { LevelUp, Toast, User } from "./types";

interface AppState {
  user: User | null;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  levelUp: LevelUp | null;
  dismissLevelUp: () => void;
}

const Ctx = createContext<AppState | null>(null);

let toastSeq = 1;

const SHOWN_EVENTS_KEY = "grimoire-shown-events";

function readShownEvents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SHOWN_EVENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const user = useUser().data ?? null;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = toastSeq++;
    // Sin temporizador aquí: cada aviso lleva su propio reloj en la pila
    // (ToastAchievement), que se para mientras se lee.
    setToasts((ts) => [...ts, { ...t, id }]);
  }, []);

  // surface API/network errors as toasts (deduped to avoid spam)
  const lastErr = useRef<{ msg: string; at: number }>({ msg: "", at: 0 });
  useEffect(() => onApiError((message) => {
    const now = Date.now();
    if (lastErr.current.msg === message && now - lastErr.current.at < 4000) return;
    lastErr.current = { msg: message, at: now };
    pushToast({ title: "Error", body: message, icon: "alert-triangle", variant: "error" });
  }), [pushToast]);

  // Vidas y penalizaciones: GET /user asienta y cuenta lo que pasó (ADR 0005). Un evento
  // no se repite aunque la app se cierre.
  useEffect(() => {
    if (!user) return;
    const { fresh, remember } = unseenEvents(user.events, readShownEvents());
    localStorage.setItem(SHOWN_EVENTS_KEY, JSON.stringify(remember));
    fresh.forEach((e) => pushToast(eventToast(e)));
  }, [user, pushToast]);

  const dismissLevelUp = useCallback(() => setLevelUp(null), []);

  // Lo que sigue a marcar, llegue cuando llegue (ADR 0008). Oro sólo si pagó y si la respuesta
  // sigue pegada al toque: horas después, las motas saldrían de cualquier botón.
  useEffect(() => onSyncResults((results) => {
    const { burst, level, achievements, syncedMarks, syncedXp } = summarizeResults(results);
    if (burst) burstFromLastPress();
    if (level) {
      setLevelUp({ level: level.new_level, title: level.title });
      playLevelUp();
      setTimeout(() => setLevelUp(null), 4200);
    }
    if (syncedMarks > 0 && syncedXp > 0) {
      pushToast({ title: "Sincronizado", body: `${syncedMarks} ${syncedMarks === 1 ? "marca" : "marcas"} · +${syncedXp} XP`, icon: "checks" });
    }
    for (const a of achievements) {
      pushToast({ title: "Logro desbloqueado", body: a.name, icon: a.icon });
    }
  }), [pushToast]);

  return (
    <Ctx.Provider value={{ user, toasts, pushToast, dismissToast, levelUp, dismissLevelUp }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
