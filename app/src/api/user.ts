import { useQuery } from '@tanstack/react-query'
import type { Toast, User, UserEvent } from '../types'
import { get } from './client'

export const useUser = () => useQuery({ queryKey: ['user'], queryFn: () => get<User>('/user') })

const eventKey = (e: UserEvent) => `${e.day}:${e.kind}`

/**
 * Los eventos aún sin mostrar y lo que hay que recordar. Un día provisional que luego se
 * asienta conserva su clave, así que no se repite.
 */
export function unseenEvents(events: UserEvent[], shown: string[]) {
  return {
    fresh: events.filter((e) => !shown.includes(eventKey(e))),
    remember: [...new Set([...shown, ...events.map(eventKey)])].slice(-60),
  }
}

const dayLabel = (day: string) =>
  new Date(`${day}T00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' })

export function eventToast(e: UserEvent): Omit<Toast, 'id'> {
  // ADR 0005: un día provisional todavía puede cambiar si llega una marca tardía
  const status = e.provisional ? 'Provisional · ' : ''
  const [first, ...rest] = e.habits
  const habits = rest.length ? `${first} y ${rest.length} más` : (first ?? 'hábito')
  // el título va en una sola línea: el toast mide 58 px de alto
  const broken = { title: `Racha rota · ${dayLabel(e.day)}`, icon: 'heart-broken', variant: 'error' as const }
  switch (e.kind) {
    case 'life_regained':
      return { title: 'Vida recuperada', body: `${status}${dayLabel(e.day)} · día perfecto`, icon: 'heart' }
    case 'life_lost':
      return { ...broken, body: `${status}−1 vida · ${habits}` }
    case 'xp_penalty':
      return { ...broken, body: `${status}−${e.xp_penalty} XP · ${habits}` }
  }
}
