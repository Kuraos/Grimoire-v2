import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import {
  usePomodoro, DEFAULT_CONFIG, freshSnapshot, type PomodoroConfig, type WorkResult,
} from "./hooks/usePomodoro";
import { bootPomodoro, recordSession, savePomodoro, sessionRequests, type PomodoroLinks } from "./api/pomodoro";
import { useTasks } from "./api/tasks";
import type { PomodoroNotice } from "./pomodoroNotify";
import { playChime } from "./sounds";
import type { ApiTask } from "./types";

type PomoHook = ReturnType<typeof usePomodoro>;
type ClockKey = "secondsLeft" | "totalSeconds" | "progress";

/** Lo que cambia cada segundo con el temporizador corriendo. Va en su propio contexto para que
 *  solo se redibuje quien muestra el tiempo, no la app entera. */
export type PomodoroClock = Pick<PomoHook, ClockKey>;

/** Lo que solo cambia en las transiciones, la configuración, el vínculo o las tareas. */
export interface PomodoroState extends Omit<PomoHook, ClockKey> {
  config: PomodoroConfig;
  setConfig: (c: PomodoroConfig) => void;
  links: PomodoroLinks;
  /** Vincula una tarea; su proyecto se hereda como valor por defecto. `null` desvincula. */
  setTaskId: (id: string | null) => void;
  setProjectId: (id: string | null) => void;
  /** Las tareas abiertas, con la cola encima: lo que se puede vincular. */
  tasks: ApiTask[];
  activeTask: ApiTask | null;
  /** Vincula una tarea y arranca el foco de una vez, desde cualquier vista. */
  startWithTask: (task: ApiTask) => void;
  /** Si el aviso con la app cerrada quedó agendado (decisión 1). */
  notice: PomodoroNotice;
}

const Ctx = createContext<PomodoroState | null>(null);
const ClockCtx = createContext<PomodoroClock | null>(null);

const NO_LINKS: PomodoroLinks = { taskId: null, projectId: null };

/**
 * El Pomodoro a nivel de app: sigue corriendo al cambiar de vista y todas ven la misma sesión y la
 * misma tarea vinculada. Va dentro de `TokenGate`, que ya corrió `bootSync`: `bootPomodoro` necesita
 * la cola restaurada para no duplicar lo que estaba en la bandeja.
 *
 * Hasta que termine de restaurar, el contexto vale `null`: un temporizador de 25:00 recién creado
 * sería falso si en disco había uno corriendo.
 */
export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<PomodoroConfig>(DEFAULT_CONFIG);
  const [links, setLinks] = useState<PomodoroLinks>(NO_LINKS);
  const [notice, setNotice] = useState<PomodoroNotice>("off");
  const linksRef = useRef(links);
  linksRef.current = links;

  const onWorkEnd = useCallback((r: WorkResult) => {
    if (r.completed) playChime();
    // Una abandonada se guarda para que las horas cuadren, pero no puntúa (decisión 7).
    void recordSession(sessionRequests.create(r, linksRef.current));
  }, []);
  // El descanso termina justo cuando nadie mira la pantalla: sin aviso, se pasa.
  const onBreakEnd = useCallback(() => playChime(), []);

  const pomo = usePomodoro(config, { onWorkEnd, onBreakEnd }, freshSnapshot(DEFAULT_CONFIG));
  const { load } = pomo;

  useEffect(() => {
    let alive = true;
    bootPomodoro()
      .then((b) => {
        if (!alive) return;
        setConfig(b.config);
        setLinks(b.links);
        load(b.timer);
        setNotice(b.notice);
        setReady(true);
      })
      .catch((e) => {
        // disco ilegible: se arranca de cero antes que dejar la vista sin temporizador
        console.error("No se pudo restaurar el pomodoro", e);
        if (alive) setReady(true);
      });
    return () => { alive = false; };
  }, [load]);

  // Guardar en cada cambio del estado, la configuración o el vínculo. El estado solo cambia en las
  // transiciones: el tick refresca la vista sin tocarlo, así que esto no corre cada segundo.
  const snapshot = pomo.snapshot;
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    savePomodoro({ config, links, timer: snapshot }).then((n) => { if (alive) setNotice(n); });
    return () => { alive = false; };
  }, [ready, config, links, snapshot]);

  const { tasks: all } = useTasks();
  const tasks = useMemo(() => all.filter((t) => t.status !== "done"), [all]);
  const activeTask = useMemo(() => all.find((t) => t.id === links.taskId) ?? null, [all, links.taskId]);

  /**
   * El proyecto de la tarea es un valor por defecto, no una imposición: se aplica al vincular y
   * desde ahí el usuario manda. Al desvincular solo se retira lo que se había heredado (v1).
   */
  const setTaskId = useCallback((id: string | null) => {
    setLinks((cur) => {
      const prev = all.find((t) => t.id === cur.taskId);
      const next = all.find((t) => t.id === id);
      const inherited = prev?.project_id != null && cur.projectId === prev.project_id;
      return {
        taskId: id,
        projectId: next?.project_id ?? (inherited ? null : cur.projectId),
      };
    });
  }, [all]);
  const setProjectId = useCallback((id: string | null) => setLinks((cur) => ({ ...cur, projectId: id })), []);

  const { startFocus } = pomo;
  const startWithTask = useCallback((task: ApiTask) => {
    // Primero el temporizador y después el vínculo: si había un bloque a medias, la sesión
    // abandonada es de la tarea que se deja, no de la que empieza.
    startFocus();
    const next = { taskId: task.id, projectId: task.project_id };
    linksRef.current = next;
    setLinks(next);
  }, [startFocus]);

  /* Dos valores: el estable no cambia con el tick, así que `App` y las rutas, que solo leen ese, no
     se redibujan mientras corre el temporizador. Las acciones del hook ya tienen identidad estable. */
  const { phase, running, workCount, cycleDone, start, pause, reset, skip } = pomo;
  const value = useMemo<PomodoroState | null>(() => ready
    ? {
      phase, running, workCount, cycleDone, snapshot, load, start, startFocus, pause, reset, skip,
      config, setConfig, links, setTaskId, setProjectId, tasks, activeTask, startWithTask, notice,
    }
    : null, [
    ready, phase, running, workCount, cycleDone, snapshot, load, start, startFocus, pause, reset, skip,
    config, links, setTaskId, setProjectId, tasks, activeTask, startWithTask, notice,
  ]);

  const { secondsLeft, totalSeconds, progress } = pomo;
  const clock = useMemo<PomodoroClock | null>(
    () => (ready ? { secondsLeft, totalSeconds, progress } : null),
    [ready, secondsLeft, totalSeconds, progress],
  );

  return (
    <Ctx.Provider value={value}>
      <ClockCtx.Provider value={clock}>{children}</ClockCtx.Provider>
    </Ctx.Provider>
  );
}

/** El estado estable y las acciones. `null` mientras se restaura de disco. */
export const usePomodoroCtx = () => useContext(Ctx);

/** El tiempo que queda. Léelo solo en el componente que lo pinta: se redibuja cada segundo.
 *  `null` mientras se restaura de disco. */
export const usePomodoroClock = () => useContext(ClockCtx);
