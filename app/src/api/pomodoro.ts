import { Preferences } from '@capacitor/preferences'
import { useQuery } from '@tanstack/react-query'
import {
  restoreConfig, restoreSnapshot, type PomodoroConfig, type PomodoroSnapshot, type WorkResult,
} from '../hooks/usePomodoro'
import { syncPomodoroNotification, type PomodoroNotice } from '../pomodoroNotify'
import type { ApiPomodoroSession, ApiTask, SessionOut } from '../types'
import { get, type ApiRequest } from './client'
import { localDate } from './habits'
import { enqueue, queryClient, useQueue, type QueueEntry, type SyncResult } from './queryClient'
import { saveQueueNow } from './sync'

/*
 * Pomodoro en el cliente (docs/tasks/fase-2-pomodoro.md, decisiones 1, 2, 8 y 9). El temporizador
 * es de este dispositivo y se guarda en Preferences; al servidor solo va la sesión terminada, por
 * la cola (ADR 0008). La sesión se decide **una vez**, al detectar el cierre: la request se arma
 * ahí, con el id que nació al empezar el bloque, y no se recalcula aunque tarde días en sincronizar.
 *
 * Para que un cierre de la app no la pierda ni la duplique, pasa por una bandeja en disco:
 *   1. la request se escribe en la bandeja (`OUTBOX_KEY`),
 *   2. se encola,
 *   3. cuando la cola ya está en disco, sale de la bandeja.
 * Al arrancar, lo que siga en la bandeja se encola si la cola no lo tiene. Un mismo id nunca se
 * encola dos veces, y si llegara a repetirse el servidor responde 200 sin efecto (fila 27).
 */

const STATE_KEY = 'grimoire-pomodoro-v1'
const OUTBOX_KEY = 'grimoire-pomodoro-outbox-v1'
const SESSIONS_PATH = '/pomodoro/sessions'

/** La tarea y el proyecto a los que va la sesión. Sin proyecto, el servidor hereda el de la tarea. */
export type PomodoroLinks = { taskId: string | null; projectId: string | null }
export type PomodoroState = { config: PomodoroConfig; links: PomodoroLinks; timer: PomodoroSnapshot }

/** Sin milisegundos, como el resto de instantes (invariante 3). */
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')

type SessionBody = {
  id: string
  task_id: string | null
  project_id: string | null
  work_minutes: number
  completed: boolean
  started_at: string
  finished_at: string
}

export const sessionRequests = {
  /** El id es el del bloque, no uno nuevo: reintentar o volver a detectar el cierre no duplica. */
  create: (r: WorkResult, links: PomodoroLinks): ApiRequest => ({
    method: 'POST',
    path: SESSIONS_PATH,
    body: {
      id: r.sessionId,
      task_id: links.taskId,
      project_id: links.projectId,
      work_minutes: r.minutes,
      completed: r.completed,
      started_at: iso(r.startedAt),
      finished_at: iso(r.finishedAt),
    } satisfies SessionBody,
    label: `Pomodoro de ${r.minutes} min · ${localDate(new Date(r.finishedAt))}`,
  }),
}

const sessionBody = (r: ApiRequest): SessionBody | null =>
  r.method === 'POST' && r.path === SESSIONS_PATH ? (r.body as SessionBody) : null

/** Día de la sesión en Bogotá: el de `finished_at`, no el de cuándo se sincronizó (fila 25). */
const sessionDay = (b: Pick<SessionBody, 'finished_at'>) => localDate(new Date(b.finished_at))

// ---------- La vista con la cola encima ----------

/**
 * Las sesiones de `day` con lo que aún no llega al servidor encima, de la más reciente a la más
 * antigua por `started_at`, como el servidor. Una sesión ya presente no se repite. El proyecto se
 * hereda de la tarea igual que en el servidor.
 */
export function applySessionQueue(
  sessions: ApiPomodoroSession[],
  entries: Pick<QueueEntry, 'request' | 'status'>[],
  day: string,
  tasks: Pick<ApiTask, 'id' | 'title' | 'project_id'>[] = [],
): { sessions: ApiPomodoroSession[]; pendingIds: Set<string> } {
  const out = [...sessions]
  const pendingIds = new Set<string>()
  for (const { request, status } of entries) {
    if (status !== 'pending' && status !== 'success') continue
    const b = sessionBody(request)
    if (!b || sessionDay(b) !== day || out.some((s) => s.id === b.id)) continue
    if (status === 'pending') pendingIds.add(b.id)
    const task = tasks.find((t) => t.id === b.task_id)
    out.push({
      id: b.id,
      task_id: b.task_id,
      project_id: b.project_id ?? task?.project_id ?? null,
      work_minutes: b.work_minutes,
      completed: b.completed,
      started_at: b.started_at,
      finished_at: b.finished_at,
      task_title: task?.title ?? null,
    })
  }
  out.sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : a.id < b.id ? 1 : -1))
  return { sessions: out, pendingIds }
}

/** Minutos de foco de una lista: solo las completas cuentan (v1). */
export const focusMinutes = (sessions: Pick<ApiPomodoroSession, 'completed' | 'work_minutes'>[]) =>
  sessions.reduce((n, s) => n + (s.completed ? s.work_minutes : 0), 0)

/**
 * Los minutos que la cola le suma a cada proyecto. Una sesión exitosa se sigue contando hasta que la
 * cola la olvida, justo después del refresco, como los conteos de Tareas.
 */
export function sessionMinuteDeltas(
  entries: Pick<QueueEntry, 'request' | 'status'>[],
  tasks: Pick<ApiTask, 'id' | 'project_id'>[] = [],
): Map<string, number> {
  const deltas = new Map<string, number>()
  const seen = new Set<string>()
  for (const { request, status } of entries) {
    if (status !== 'pending' && status !== 'success') continue
    const b = sessionBody(request)
    if (!b || !b.completed || seen.has(b.id)) continue
    seen.add(b.id)
    const project = b.project_id ?? tasks.find((t) => t.id === b.task_id)?.project_id
    if (project) deltas.set(project, (deltas.get(project) ?? 0) + b.work_minutes)
  }
  return deltas
}

/** El total que trajo una sesión sincronizada y **de qué día es**: si sincronizó tarde, no es hoy. */
export function sessionDayTotal(r: SyncResult): { day: string; minutes: number } | null {
  const b = sessionBody(r.request)
  const data = r.data as SessionOut | null
  if (!b || typeof data?.total_today_minutes !== 'number') return null
  return { day: sessionDay(b), minutes: data.total_today_minutes }
}

// ---------- Estado y bandeja en disco ----------

// Todo lo de disco va en una sola fila: así guardar el estado nunca adelanta a la bandeja.
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn)
  chain = run.catch(() => {})
  return run
}

async function readOutbox(): Promise<ApiRequest[]> {
  const { value } = await Preferences.get({ key: OUTBOX_KEY })
  try {
    const list = JSON.parse(value ?? '[]')
    return Array.isArray(list) ? list.filter((r) => sessionBody(r)?.id) : []
  } catch {
    return []
  }
}

const writeOutbox = (list: ApiRequest[]) => Preferences.set({ key: OUTBOX_KEY, value: JSON.stringify(list) })

/** ¿Ya está en la cola, en cualquier estado? */
function queued(id: string): boolean {
  return queryClient.getMutationCache().getAll().some((m) => {
    const r = m.state.variables as ApiRequest | undefined
    return r && sessionBody(r)?.id === id
  })
}

/**
 * Encola, en orden, lo que haya en la bandeja y no esté en la cola, y la vacía cuando la cola ya
 * está en disco. Con dos decisiones para el mismo id gana la primera: un cierre detectado otra vez
 * tras un crash no cambia lo que se iba a mandar.
 */
async function drainOutbox(): Promise<void> {
  const outbox = await readOutbox()
  if (outbox.length === 0) return
  for (const r of outbox) if (!queued(sessionBody(r)!.id)) enqueue(r)
  await saveQueueNow()
  await writeOutbox([])
}

/** Registra una sesión ya decidida: primero a la bandeja en disco, después a la cola. */
export const recordSession = (request: ApiRequest): Promise<void> =>
  serial(async () => {
    await writeOutbox([...(await readOutbox()), request])
    await drainOutbox()
  })

/**
 * Guarda el estado y después deja la notificación de acuerdo con él (decisión 1: primero se guarda,
 * luego se agenda). Si avisar falla, el temporizador sigue: el resultado es para la vista.
 */
export const savePomodoro = (state: PomodoroState): Promise<PomodoroNotice> =>
  serial(async () => {
    await Preferences.set({ key: STATE_KEY, value: JSON.stringify(state) })
    return syncPomodoroNotification(state.timer)
  })

const asId = (v: unknown) => (typeof v === 'string' && v ? v : null)

/**
 * Arranque: restaura el estado, encola lo que quedó en la bandeja y registra lo que venció con la app
 * cerrada (decisión 2). Después de `bootSync`, que restaura la cola. Sin conexión funciona igual: la
 * sesión queda en la cola.
 */
export async function bootPomodoro(now = Date.now()): Promise<PomodoroState & { notice: PomodoroNotice }> {
  const { value } = await Preferences.get({ key: STATE_KEY })
  let stored: Partial<{ config: unknown; links: Partial<PomodoroLinks>; timer: unknown }> = {}
  try {
    stored = JSON.parse(value ?? '{}') ?? {}
  } catch {
    // JSON a medio escribir: se arranca de cero
  }
  const config = restoreConfig(stored.config)
  const links = { taskId: asId(stored.links?.taskId), projectId: asId(stored.links?.projectId) }
  const { next: timer, closed } = restoreSnapshot(stored.timer, config, now)
  await serial(drainOutbox)
  if (closed) await recordSession(sessionRequests.create(closed, links))
  const state = { config, links, timer }
  return { ...state, notice: await savePomodoro(state) }
}

// ---------- Lecturas ----------

export function usePomodoroToday(tasks: Pick<ApiTask, 'id' | 'title' | 'project_id'>[] = []) {
  const day = localDate(new Date())
  const query = useQuery({
    queryKey: ['pomodoro', 'today', day],
    queryFn: () => get<ApiPomodoroSession[]>(`/pomodoro/today?date=${day}`),
  })
  const queue = useQueue()
  const view = applySessionQueue(query.data ?? [], queue, day, tasks)
  // el total es de `day`, que es el día de las sesiones de esta lista
  return { query, day, ...view, totalMinutes: focusMinutes(view.sessions) }
}
