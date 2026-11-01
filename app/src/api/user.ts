import { useQuery } from '@tanstack/react-query'
import type { CompleteOut, Toast, UnlockedAchievement, User, UserEvent } from '../types'
import { get } from './client'
import type { SyncResult } from './queryClient'

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

/** Menos que esto después de tocar: la respuesta todavía se siente como respuesta al toque. */
const FRESH_MS = 2000

/**
 * Lo que un lote de escrituras le dice a la pantalla: un solo resumen de lo que llegó tarde,
 * un logro por cada uno y un solo ascenso, el más alto.
 */
export function summarizeResults(results: SyncResult[]) {
  const xp = results.filter((r): r is SyncResult & { data: CompleteOut } =>
    typeof (r.data as CompleteOut | null)?.xp_earned === 'number')
  const late = xp.filter((r) => r.ageMs >= FRESH_MS)
  const leveled = xp.filter((r) => r.data.leveled_up).map((r) => r.data)
  return {
    burst: xp.some((r) => r.ageMs < FRESH_MS && r.data.xp_earned > 0),
    level: leveled.reduce<CompleteOut | null>((a, b) => (!a || b.new_level > a.new_level ? b : a), null),
    achievements: xp.flatMap((r): UnlockedAchievement[] => r.data.achievements_unlocked),
    syncedXp: late.reduce((s, r) => s + r.data.xp_earned, 0),
    // deshacer resta: marcar y deshacer sin conexión no es una marca sincronizada
    syncedMarks: late.filter((r) => !isTask(r)).reduce((s, r) => s + Math.sign(r.data.xp_earned), 0),
    syncedTasks: late.filter(isTask).reduce((s, r) => s + Math.sign(r.data.xp_earned), 0),
  }
}

const isTask = (r: SyncResult) => r.request.path.startsWith('/tasks')

/** «2 marcas · 1 tarea · +55 XP», o `null` si el lote no dejó nada que contar. */
export function syncedSummary({ syncedMarks, syncedTasks, syncedXp }: Pick<ReturnType<typeof summarizeResults>, 'syncedMarks' | 'syncedTasks' | 'syncedXp'>): string | null {
  const parts = [
    syncedMarks > 0 && `${syncedMarks} ${syncedMarks === 1 ? 'marca' : 'marcas'}`,
    syncedTasks > 0 && `${syncedTasks} ${syncedTasks === 1 ? 'tarea' : 'tareas'}`,
  ].filter(Boolean)
  return parts.length > 0 && syncedXp > 0 ? `${parts.join(' · ')} · +${syncedXp} XP` : null
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
