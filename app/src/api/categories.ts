import { useQuery } from '@tanstack/react-query'
import { v7 as uuidv7 } from 'uuid'
import type { HabitCategory } from '../types'
import { get } from './client'
import { useSend } from './queryClient'

export const useHabitCategories = () =>
  useQuery({
    queryKey: ['habit-categories'],
    queryFn: () => get<HabitCategory[]>('/habit-categories'),
  })

export function useCategoryActions() {
  const { send, pending } = useSend()
  return {
    pending,
    create: (name: string, color: string) =>
      send<HabitCategory>({ method: 'POST', path: '/habit-categories', body: { id: uuidv7(), name, color } }),
    remove: (id: string) => send<null>({ method: 'DELETE', path: `/habit-categories/${id}` }),
  }
}
