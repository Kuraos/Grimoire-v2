import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { v7 as uuidv7 } from 'uuid'
import type { Habit, HabitDetail, HabitInput } from '../types'
import { get, type ApiRequest } from './client'
import { enqueue, useQueue, type QueueEntry } from './queryClient'

/** El día de una marca se fija al tocar, en la zona del usuario (ADR 0004). */
export const localDate = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now)

type Named = Pick<Habit, 'id' | 'name'>

// Los ids nacen aquí, una sola vez: reintentar la misma request no duplica (ADR 0004).
export const habitRequests = {
  create: (input: HabitInput): ApiRequest => ({
    method: 'POST',
    path: '/habits',
    body: { id: uuidv7(), ...input },
    label: `Crear ${input.name}`,
  }),
  update: (h: Named, patch: Partial<HabitInput> | { active: boolean }, verb = 'Editar'): ApiRequest => ({
    method: 'PATCH',
    path: `/habits/${h.id}`,
    body: patch,
    label: `${verb} ${h.name}`,
  }),
  archive: (h: Named): ApiRequest => ({
    method: 'DELETE',
    path: `/habits/${h.id}`,
    label: `Archivar ${h.name}`,
  }),
  complete: (h: Named, now = new Date()): ApiRequest => {
    const local_date = localDate(now)
    return {
      method: 'POST',
      path: `/habits/${h.id}/complete`,
      body: { id: uuidv7(), local_date },
      label: `Marcar ${h.name} · ${local_date}`,
    }
  },
  undo: (h: Named, markId: string): ApiRequest => ({
    method: 'DELETE',
    path: `/habits/${h.id}/marks/${markId}`,
    label: `Deshacer ${h.name}`,
  }),
}

/**
 * La lista con lo que aún no llega al servidor encima. Es derivada, no un cambio en la caché:
 * sobrevive a un refetch y a reiniciar, y no hay nada que revertir si se rechaza. Racha,
 * constancia y XP no se predicen: son reglas del dominio y cambian al sincronizar.
 */
export function applyQueue(
  habits: Habit[],
  entries: Pick<QueueEntry, 'request' | 'status'>[],
  today: string,
  includeArchived: boolean,
): { habits: Habit[]; pendingIds: Set<string> } {
  let out = habits
  const pendingIds = new Set<string>()
  const change = (id: string, fn: (h: Habit) => Habit) => {
    out = out.map((h) => (h.id === id ? fn(h) : h))
  }
  for (const { request: r, status } of entries) {
    if (status !== 'pending' && status !== 'success') continue
    const [, , id, action, markId] = r.path.split('/')
    const body = r.body as Record<string, never> | undefined
    const target = id ?? (body?.id as string | undefined)
    if (target && status === 'pending') pendingIds.add(target)

    if (r.method === 'POST' && !id) {
      if (out.some((h) => h.id === target)) continue
      out = [...out, {
        ...(body as unknown as HabitInput & { id: string }),
        active: true,
        created_at: new Date().toISOString(),
        streak: 0,
        completion_rate: 0,
        done_today: false,
        last_mark: null,
      }]
    } else if (r.method === 'PATCH') {
      change(id, (h) => ({ ...h, ...(body as Partial<Habit>) }))
    } else if (r.method === 'DELETE' && !action) {
      if (includeArchived) change(id, (h) => ({ ...h, active: false }))
      else out = out.filter((h) => h.id !== id)
    } else if (action === 'complete') {
      const { id: mark, local_date } = body as unknown as { id: string; local_date: string }
      change(id, (h) => ({
        ...h,
        done_today: h.done_today || local_date === today,
        last_mark: { id: mark, local_date },
      }))
    } else if (action === 'marks') {
      change(id, (h) => {
        if (h.last_mark?.id !== markId) return h
        return { ...h, done_today: h.done_today && h.last_mark.local_date !== today, last_mark: null }
      })
    }
  }
  return { habits: out, pendingIds }
}

export function useHabits(includeArchived: boolean) {
  const query = useQuery({
    queryKey: ['habits', 'list', includeArchived],
    queryFn: () => get<Habit[]>(`/habits?include_archived=${includeArchived}`),
    placeholderData: keepPreviousData,
  })
  const queue = useQueue()
  return { query, queue, ...applyQueue(query.data ?? [], queue, localDate(new Date()), includeArchived) }
}

export const useHabitDetail = (id: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['habits', 'detail', id],
    queryFn: () => get<HabitDetail>(`/habits/${id}`),
    enabled: id !== null && enabled,
  })

export const useHabitHeatmap = () =>
  useQuery({
    queryKey: ['habits', 'heatmap'],
    queryFn: () => get<{ date: string; count: number }[]>('/habits/heatmap'),
  })

export const habitActions = {
  create: (input: HabitInput) => enqueue(habitRequests.create(input)),
  update: (h: Named, patch: Partial<HabitInput>) => enqueue(habitRequests.update(h, patch)),
  restore: (h: Named) => enqueue(habitRequests.update(h, { active: true }, 'Restaurar')),
  archive: (h: Named) => enqueue(habitRequests.archive(h)),
  complete: (h: Named) => enqueue(habitRequests.complete(h)),
  undo: (h: Named, markId: string) => enqueue(habitRequests.undo(h, markId)),
}
