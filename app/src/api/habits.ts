import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { v7 as uuidv7 } from 'uuid'
import type { CompleteOut, Habit, HabitDetail, HabitInput } from '../types'
import { get, type ApiRequest } from './client'
import { useSend } from './queryClient'

/** El día de una marca se fija al tocar, en la zona del usuario (ADR 0004). */
export const localDate = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now)

// Los ids nacen aquí, una sola vez: reintentar la misma request no duplica (ADR 0004).
export const habitRequests = {
  create: (input: HabitInput): ApiRequest => ({
    method: 'POST',
    path: '/habits',
    body: { id: uuidv7(), ...input },
  }),
  update: (id: string, patch: Partial<HabitInput> | { active: boolean }): ApiRequest => ({
    method: 'PATCH',
    path: `/habits/${id}`,
    body: patch,
  }),
  archive: (id: string): ApiRequest => ({ method: 'DELETE', path: `/habits/${id}` }),
  complete: (id: string, now = new Date()): ApiRequest => ({
    method: 'POST',
    path: `/habits/${id}/complete`,
    body: { id: uuidv7(), local_date: localDate(now) },
  }),
  undo: (id: string, markId: string): ApiRequest => ({
    method: 'DELETE',
    path: `/habits/${id}/marks/${markId}`,
  }),
}

export const useHabits = (includeArchived: boolean) =>
  useQuery({
    queryKey: ['habits', 'list', includeArchived],
    queryFn: () => get<Habit[]>(`/habits?include_archived=${includeArchived}`),
    placeholderData: keepPreviousData,
  })

export const useHabitDetail = (id: string | null) =>
  useQuery({
    queryKey: ['habits', 'detail', id],
    queryFn: () => get<HabitDetail>(`/habits/${id}`),
    enabled: id !== null,
  })

export const useHabitHeatmap = () =>
  useQuery({
    queryKey: ['habits', 'heatmap'],
    queryFn: () => get<{ date: string; count: number }[]>('/habits/heatmap'),
  })

export function useHabitActions() {
  const { send, pending } = useSend()
  return {
    pending,
    create: (input: HabitInput) => send<Habit>(habitRequests.create(input)),
    update: (id: string, patch: Partial<HabitInput>) => send<Habit>(habitRequests.update(id, patch)),
    restore: (id: string) => send<Habit>(habitRequests.update(id, { active: true })),
    archive: (id: string) => send<null>(habitRequests.archive(id)),
    complete: (id: string) => send<CompleteOut>(habitRequests.complete(id)),
    undo: (id: string, markId: string) => send<CompleteOut>(habitRequests.undo(id, markId)),
  }
}
