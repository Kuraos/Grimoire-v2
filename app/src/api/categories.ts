import { useMutation, useQuery } from '@tanstack/react-query'
import { v7 as uuidv7 } from 'uuid'
import type { HabitCategory } from '../types'
import { get, type ApiRequest } from './client'
import { DIRECT_MUTATION } from './queryClient'

export const useHabitCategories = () =>
  useQuery({
    queryKey: ['habit-categories'],
    queryFn: () => get<HabitCategory[]>('/habit-categories'),
  })

/** Fuera de la cola: repetir un DELETE da 404, así que no cumple su contrato (ADR 0008). */
export function useCategoryActions() {
  const m = useMutation<unknown, Error, ApiRequest>({ mutationKey: DIRECT_MUTATION })
  return {
    pending: m.isPending,
    create: (name: string, color: string) =>
      m.mutateAsync({ method: 'POST', path: '/habit-categories', body: { id: uuidv7(), name, color } }),
    remove: (id: string) => m.mutateAsync({ method: 'DELETE', path: `/habit-categories/${id}` }),
  }
}
