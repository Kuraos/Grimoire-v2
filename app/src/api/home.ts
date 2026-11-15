import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ApiTask, Habit } from '../types'
import { streakMultiplier } from '../utils'
import { useDiaryDay } from './diary'
import { localDate, useHabits } from './habits'
import { usePomodoroToday } from './pomodoro'
import { useQueue, type QueueEntry } from './queryClient'
import { getLink, subscribeLink, type Link } from './sync'
import { sortTasks, useTasks } from './tasks'
import { useUser } from './user'

/*
 * Lo que el Inicio muestra (docs/tasks/fase-2-transversal.md, 2.5.3), sin leer nada nuevo. Hábitos,
 * tareas y minutos de foco llevan la cola encima: es lo que el dispositivo sabe. El XP (barra, nivel,
 * «XP hoy») es el último que dijo el servidor hasta sincronizar (decisión B1): lo decide el servidor.
 */

/** «X de N»: todos los hábitos activos, como en la v1 (`Dashboard.tsx:121`). */
export const dayCount = (habits: Pick<Habit, 'done_today'>[]) => ({
  done: habits.filter((h) => h.done_today).length,
  total: habits.length,
})

/**
 * Bono de racha de la barra: `streakMultiplier` de la mejor racha entre todos los hábitos
 * (`Dashboard.tsx:122-123`), 1 sin hábitos. La racha es la de la vista Hábitos: la del servidor,
 * porque la cola no la adelanta (`applyQueue`).
 */
export const streakBonus = (habits: Pick<Habit, 'streak'>[]) =>
  streakMultiplier(habits.reduce((m, h) => Math.max(m, h.streak), 0))

/**
 * Grupos por categoría en el orden en que llegan (`Dashboard.tsx:127-132`). `GET /habits` ya viene
 * por `category, name`, así que salen en orden alfabético, como en la v1.
 */
export function groupByCategory<H extends Pick<Habit, 'category'>>(habits: H[]) {
  const groups: { category: string; items: H[] }[] = []
  for (const h of habits) {
    const found = groups.find((g) => g.category === h.category)
    if (found) found.items.push(h)
    else groups.push({ category: h.category, items: [h] })
  }
  return groups
}

/**
 * Las 4 primeras abiertas por prioridad (`Dashboard.tsx:41,46`). `useTasks` las da en el orden del
 * tablero y `sortTasks` es estable: los empates siguen el tablero, no la creación (fila 51).
 */
export const priorityTasks = (tasks: ApiTask[]) =>
  sortTasks(tasks.filter((t) => t.status !== 'done'), 'priority').slice(0, 4)

/**
 * El aviso global (decisión B). Pendientes = escrituras en espera; las rechazadas tienen su propio
 * aviso. Sin token avisa `TokenGate`, no esto. Con todo arriba, nada.
 */
export function syncNotice(link: Link, queue: Pick<QueueEntry, 'status'>[]): string | null {
  if (!link.authorized) return null
  const n = queue.filter((e) => e.status === 'pending').length
  const pending = `${n} ${n === 1 ? 'pendiente' : 'pendientes'}`
  if (!link.connected) return n > 0 ? `sin conexión · ${pending}` : 'sin conexión'
  return n > 0 ? pending : null
}

const DAY_MS = 86_400_000
/** Bogotá no tiene horario de verano: UTC−5 todo el año. */
const BOGOTA_OFFSET_MS = 5 * 3_600_000

/** Milisegundos hasta la próxima medianoche de Bogotá. */
export function msToMidnight(now: number): number {
  const local = now - BOGOTA_OFFSET_MS
  return (Math.floor(local / DAY_MS) + 1) * DAY_MS - local
}

/**
 * «Hoy» en Bogotá, que cambia solo a medianoche aunque nada más redibuje la vista. Un temporizador
 * suspendido en segundo plano se dispara al volver, y entonces recalcula.
 */
export function useToday(): string {
  const [day, setDay] = useState(() => localDate(new Date()))
  useEffect(() => {
    const t = setTimeout(() => setDay(localDate(new Date())), msToMidnight(Date.now()) + 1000)
    return () => clearTimeout(t)
  }, [day])
  return day
}

export const useLink = () => useSyncExternalStore(subscribeLink, getLink)

/** Todo el Inicio. Las tarjetas reciben de aquí sus props (AGENTS.md, interfaz 4). */
export function useHome() {
  const today = useToday()
  const user = useUser()
  const habits = useHabits(false)
  const tasks = useTasks()
  const pomodoro = usePomodoroToday(tasks.tasks)
  const diary = useDiaryDay(today)
  const queue = useQueue()
  const link = useLink()
  const { done, total } = dayCount(habits.habits)
  return {
    today,
    /** Nivel, título y avance tal como los da `GET /user` (`level_progress`). */
    user: user.data ?? null,
    streakBonus: streakBonus(habits.habits),
    habitsDone: done,
    habitsTotal: total,
    habits: habits.habits,
    pendingHabitIds: habits.pendingIds,
    groups: groupByCategory(habits.habits),
    priorityTasks: priorityTasks(tasks.tasks),
    /** Del servidor (`GET /diary/{hoy}`, decisión A1): no se adelanta con la cola. */
    xpToday: diary.summary?.xp_earned ?? null,
    /** Con las sesiones en cola, como la vista Pomodoro. */
    focusMinutes: pomodoro.totalMinutes,
    notice: syncNotice(link, queue),
    loading: user.data === undefined && habits.query.data === undefined,
  }
}
