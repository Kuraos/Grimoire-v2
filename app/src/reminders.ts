import { useEffect, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { useTasks } from './api/tasks'
import { ensureNotifications, isNative, NOTIFICATION_CHANNEL } from './notify'
import type { ApiTask } from './types'

/*
 * Contrato del espacio de notificaciones (ADR 0003):
 *
 * - Toda notificación agendada lleva `extra.kind`, que dice de qué módulo es. Las de tareas llevan
 *   `{ kind: 'task', taskId, remindAt }`.
 * - Cada módulo solo agenda y cancela las de su `kind`. La reconciliación de tareas nunca toca una
 *   notificación de otro `kind`, ni una sin `extra`. Por eso aquí no existe `cancelAll`.
 * - Agendar con un id existente reemplaza la notificación, sin importar su `kind`. Por eso los ids se
 *   reparten: 0 a FIXED_ID_MAX, reservados para las fijas (Pomodoro = 1000), y los de tareas viven en
 *   [TASK_ID_MIN, TASK_ID_MAX], sin salir de ahí ni con el hash ni al resolver una colisión.
 * - `getPending` del plugin devuelve todo lo guardado, también lo ya disparado. Estar en esa lista
 *   no significa que falte sonar.
 */

export const FIXED_ID_MAX = 9_999
export const TASK_ID_MIN = 1_000_000
export const TASK_ID_MAX = 2 ** 31 - 1
const TASK_KIND = 'task'

export type PendingNotification = { id: number; body?: string; extra?: unknown }
type TaskExtra = { kind: 'task'; taskId: string; remindAt: string }
export type ReminderToSchedule = { id: number; title: string; body: string; at: Date; extra: TaskExtra }
type Reminding = Pick<ApiTask, 'id' | 'title' | 'status' | 'remind_at'>

const isTaskExtra = (x: unknown): x is TaskExtra => (x as TaskExtra | null | undefined)?.kind === TASK_KIND

/** FNV-1a de 32 bits, llevado al rango de tareas. */
export function hashTaskId(taskId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < taskId.length; i++) {
    h ^= taskId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return TASK_ID_MIN + (h >>> 0) % (TASK_ID_MAX - TASK_ID_MIN + 1)
}

/** Al probar el siguiente id, el final del rango da la vuelta al principio, nunca a los reservados. */
export const nextTaskId = (id: number) => (id === TASK_ID_MAX ? TASK_ID_MIN : id + 1)

/** El UUID en un entero, saltando lo ocupado: la colisión se resuelve aquí. */
function freeId(taskId: string, used: Set<number>): number {
  let id = hashTaskId(taskId)
  while (used.has(id)) id = nextTaskId(id)
  return id
}

const toSchedule = (id: number, t: Reminding): ReminderToSchedule => ({
  id,
  title: 'Recordatorio',
  body: t.title,
  at: new Date(t.remind_at!),
  extra: { kind: TASK_KIND, taskId: t.id, remindAt: t.remind_at! },
})

/**
 * Qué agendar y qué cancelar: función pura de la lista de tareas y de lo agendado.
 *
 * Una hora pasada nunca se agenda, porque dispararía al instante. Pero una alarma ya agendada cuya
 * hora no cambió se deja como está, aunque esa hora ya pasó: puede haber sonado o estar a punto,
 * si Android la retrasó, y cancelarla perdería el aviso.
 */
export function reminderPlan(tasks: Reminding[], pending: PendingNotification[], nowMs: number) {
  const open = new Map(tasks.filter((t) => t.status !== 'done' && t.remind_at).map((t) => [t.id, t]))
  const future = (t: Reminding) => new Date(t.remind_at!).getTime() > nowMs
  const used = new Set(pending.map((p) => p.id))
  const seen = new Set<string>()
  const cancel: number[] = []
  const schedule: ReminderToSchedule[] = []

  for (const p of pending) {
    if (!isTaskExtra(p.extra)) continue
    const t = open.get(p.extra.taskId)
    if (!t || seen.has(t.id)) {
      cancel.push(p.id)
      continue
    }
    seen.add(t.id)
    const same = new Date(p.extra.remindAt).getTime() === new Date(t.remind_at!).getTime()
    if (same && p.body === t.title) continue
    cancel.push(p.id)
    // el mismo id: el aviso de esta tarea sigue siendo uno solo
    if (future(t)) schedule.push(toSchedule(p.id, t))
  }

  // en orden de id, para que una colisión se resuelva igual en cualquier dispositivo
  for (const t of [...open.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (seen.has(t.id) || !future(t)) continue
    const id = freeId(t.id, used)
    used.add(id)
    schedule.push(toSchedule(id, t))
  }
  return { cancel, schedule }
}

/** Aplica el plan. Cancela primero: un reagendado reutiliza el id. Sin permiso, solo cancela. */
export async function reconcileReminders(tasks: Reminding[], nowMs = Date.now()): Promise<void> {
  const { notifications } = await LocalNotifications.getPending()
  const { cancel, schedule } = reminderPlan(tasks, notifications, nowMs)
  if (cancel.length > 0) {
    await LocalNotifications.cancel({ notifications: cancel.map((id) => ({ id })) })
  }
  if (schedule.length === 0 || !(await ensureNotifications())) return
  await LocalNotifications.schedule({
    notifications: schedule.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      channelId: NOTIFICATION_CHANNEL,
      schedule: { at: r.at, allowWhileIdle: true },
      extra: r.extra,
    })),
  })
}

/** En web: lo que venció desde la última revisión. Lo vencido antes de abrir no avisa. */
export const dueBetween = (tasks: Reminding[], fromMs: number, toMs: number) =>
  tasks.filter((t) => {
    if (t.status === 'done' || !t.remind_at) return false
    const at = new Date(t.remind_at).getTime()
    return at > fromMs && at <= toMs
  })

const WEB_CHECK_MS = 30_000

/** Sin UI: mantiene los recordatorios al día con la lista. Sin datos todavía, no toca nada. */
export function TaskReminders() {
  const { query, tasks } = useTasks()
  const loaded = query.data !== undefined
  const latest = useRef(tasks)
  latest.current = tasks
  // nada de ejecuciones cruzadas: dos a la vez podrían agendar con el mismo `getPending`
  const chain = useRef<Promise<void>>(Promise.resolve())
  const signature = JSON.stringify(
    tasks.filter((t) => t.remind_at).map((t) => [t.id, t.title, t.status, t.remind_at]),
  )

  useEffect(() => {
    if (!loaded || !isNative()) return
    const run = () => {
      chain.current = chain.current
        .then(() => reconcileReminders(latest.current))
        .catch((e) => console.error('No se pudieron reconciliar los recordatorios', e))
    }
    run()
    // al volver a la app: pudo cambiar el permiso en Ajustes
    const handle = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) run() })
    return () => { void handle.then((h) => h.remove()) }
  }, [loaded, signature])

  useEffect(() => {
    if (isNative() || typeof Notification === 'undefined') return
    if (Notification.permission === 'default' && latest.current.some((t) => t.remind_at)) {
      Notification.requestPermission().catch(() => {})
    }
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      if (Notification.permission === 'granted') {
        for (const t of dueBetween(latest.current, last, now)) new Notification('Recordatorio', { body: t.title })
      }
      last = now
    }, WEB_CHECK_MS)
    return () => clearInterval(id)
  }, [signature])

  return null
}
