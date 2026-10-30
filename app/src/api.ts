import { v7 as uuidv7 } from 'uuid'

export const API_URL = 'https://grimoire.jbustosbriceno.workers.dev'

export type Habit = {
  id: string
  name: string
  streak: number
  done_today: boolean
}

export type CompleteOut = {
  xp_earned: number
  new_xp: number
  new_level: number
  title: string
  leveled_up: boolean
  streak: number
}

async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail ?? `HTTP ${res.status}`)
  return data as T
}

export const listHabits = (token: string) => call<Habit[]>(token, '/habits')

// el id de la marca lo genera el cliente (ADR 0004)
export const completeHabit = (token: string, habitId: string, markId = uuidv7()) =>
  call<CompleteOut>(token, `/habits/${habitId}/complete`, { id: markId })
