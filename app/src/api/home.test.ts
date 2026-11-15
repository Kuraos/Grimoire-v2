// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ApiTask, Habit } from '../types'
import { dayCount, groupByCategory, msToMidnight, priorityTasks, streakBonus, syncNotice } from './home'

/** Sobrevive a `vi.resetModules()`: es el disco. */
const disk = vi.hoisted(() => new Map<string, string>())
const net = vi.hoisted(() => ({ connected: false, listener: null as null | ((s: { connected: boolean }) => void) }))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: disk.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => void disk.set(key, value),
  },
}))
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: async () => ({ connected: net.connected }),
    addListener: async (_: string, fn: (s: { connected: boolean }) => void) => {
      net.listener = fn
      return { remove: async () => {} }
    },
  },
}))
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: { get: async () => 'tok', set: async () => {}, remove: async () => {} },
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }))
vi.mock('@capacitor/app', () => ({ App: { addListener: () => Promise.resolve({ remove: () => {} }) } }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---------- Casos de la 2.5.1 (caracterizacion-v1.md, «Casos del Inicio») ----------

const habit = (over: Partial<Habit>): Habit => ({
  id: 'h', name: 'H', category: 'Otro', frequency: 'daily', days: null, target_per_week: 1,
  xp_reward: 20, color: '#000', active: true, notes: null, tags: null, created_at: 'x',
  streak: 0, completion_rate: 0, done_today: false, last_mark: null, ...over,
})

test('bono de racha: la mejor racha de todos los hábitos, 1 sin hábitos o con todas en 0', () => {
  const s = (...streaks: number[]) => streakBonus(streaks.map((streak) => ({ streak })))
  expect(s()).toBe(1)
  expect(s(0, 0)).toBe(1)
  expect(s(6, 3)).toBe(1)
  expect(s(7, 3)).toBe(1.1)
  expect(s(13, 14, 2)).toBe(1.2)
  expect(s(29, 30)).toBe(1.35)
  expect(s(100)).toBe(1.75)
})

test('grupos por categoría en el orden en que llegan de GET /habits', () => {
  // GET /habits ya viene por `category, name`: el agrupado no reordena
  const g = groupByCategory([
    habit({ category: 'Mente', name: 'Leer' }),
    habit({ category: 'Salud', name: 'Agua' }),
    habit({ category: 'Salud', name: 'Correr' }),
  ])
  expect(g.map((x) => [x.category, x.items.map((h) => h.name)])).toEqual([
    ['Mente', ['Leer']], ['Salud', ['Agua', 'Correr']],
  ])
  // si llegan intercaladas, cada categoría nueva abre grupo al final y no se reordena
  expect(groupByCategory([habit({ category: 'B' }), habit({ category: 'A' }), habit({ category: 'B' })])
    .map((x) => [x.category, x.items.length])).toEqual([['B', 2], ['A', 1]])
  expect(groupByCategory([])).toEqual([])
})

const task = (id: string, priority: ApiTask['priority'], over: Partial<ApiTask> = {}): ApiTask => ({
  id, title: id, priority, due_date: null, status: 'todo', rank: id, completed: false,
  completed_at: null, completed_on: null, project_id: null, checklist: [],
  ...over,
} as unknown as ApiTask)

test('tareas prioritarias: las 4 primeras abiertas por prioridad y fecha', () => {
  // en orden del tablero (rank): A, B, C, D, E
  const t = [
    task('A', 'low'), task('B', 'high'), task('C', 'medium'), task('D', 'high'),
    task('E', 'high', { due_date: '2026-03-05' }),
  ]
  expect(priorityTasks(t).map((x) => x.id)).toEqual(['E', 'B', 'D', 'C'])
  expect(priorityTasks([
    task('A', 'medium', { due_date: '2026-03-10' }), task('B', 'medium', { due_date: '2026-03-02' }), task('C', 'medium'),
  ]).map((x) => x.id)).toEqual(['B', 'A', 'C'])
  expect(priorityTasks([task('A', 'low'), task('B', 'low')]).map((x) => x.id)).toEqual(['A', 'B'])
  expect(priorityTasks([])).toEqual([])
  expect(priorityTasks([task('A', 'high', { status: 'done', completed: true }), task('B', 'low')]).map((x) => x.id))
    .toEqual(['B'])
})

test('empates de prioridad: el orden del tablero, no el de creación (fila 51)', () => {
  // creada primero (id menor) pero arrastrada después en el tablero (rank mayor)
  const first = task('019a-1', 'high', { rank: 'm', created_at: '2026-03-01T00:00:00Z' } as Partial<ApiTask>)
  const second = task('019a-2', 'high', { rank: 'c', created_at: '2026-03-02T00:00:00Z' } as Partial<ApiTask>)
  // useTasks las entrega en orden del tablero
  expect(priorityTasks([second, first]).map((x) => x.id)).toEqual(['019a-2', '019a-1'])
})

test('aviso: distingue sin red, cola sin subir, sin token y todo arriba; las rechazadas no cuentan', () => {
  const up = { connected: true, authorized: true }
  const off = { connected: false, authorized: true }
  const q = (...s: ('pending' | 'error' | 'success')[]) => s.map((status) => ({ status }))
  expect(syncNotice(off, q('pending', 'pending', 'error'))).toBe('sin conexión · 2 pendientes')
  expect(syncNotice(off, q('pending'))).toBe('sin conexión · 1 pendiente')
  expect(syncNotice(off, q())).toBe('sin conexión')
  expect(syncNotice(up, q('pending', 'pending', 'pending'))).toBe('3 pendientes')
  expect(syncNotice(up, q('error', 'success'))).toBeNull()
  expect(syncNotice(up, q())).toBeNull()
  // con 401 avisa TokenGate: nunca «sin conexión», haya red o no
  expect(syncNotice({ connected: true, authorized: false }, q('pending'))).toBeNull()
  expect(syncNotice({ connected: false, authorized: false }, q('pending'))).toBeNull()
})

test('«X de N» cuenta todos los hábitos activos', () => {
  expect(dayCount([{ done_today: true }, { done_today: false }, { done_today: true }])).toEqual({ done: 2, total: 3 })
  expect(dayCount([])).toEqual({ done: 0, total: 0 })
})

test('la medianoche de Bogotá es a las 05:00 UTC', () => {
  expect(msToMidnight(Date.parse('2026-03-03T04:59:00Z'))).toBe(60_000)
  expect(msToMidnight(Date.parse('2026-03-03T05:00:00Z'))).toBe(86_400_000)
})

// ---------- El Inicio entero, con módulos frescos en cada arranque ----------

const LEER = habit({ id: '019a0000-0000-7000-8000-000000000001', name: 'Leer', category: 'Mente', streak: 6 })
const CORRER = habit({ id: '019a0000-0000-7000-8000-000000000002', name: 'Correr', category: 'Salud', streak: 2 })
const USER = {
  id: 'u', name: 'Johan', xp: 100, level: 1, title: 'Iniciado', lives: 3, settled_through: null,
  xp_for_current_level: 0, xp_for_next_level: 400, xp_into_level: 100, xp_span: 400, events: [],
}

let calls: { method: string; path: string }[]
let habitsDone: Set<string>

function stubServer() {
  calls = []
  habitsDone = new Set()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    calls.push({ method: init.method!, path })
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    if (path === '/user') return json(USER)
    if (path.startsWith('/habits?')) return json([LEER, CORRER].map((h) => ({ ...h, done_today: habitsDone.has(h.id) })))
    if (path === '/tasks') return json([])
    if (path.startsWith('/pomodoro/today')) return json([])
    if (path.startsWith('/diary/')) {
      const day = path.slice('/diary/'.length)
      return json({
        entry: { id: null, local_date: day, content: '', tags: null, save_id: null, updated_at: null },
        conflicts: [],
        summary: { habits_done: [], pomodoro_sessions: [], pomodoro_minutes: 0, xp_earned: 20 },
      })
    }
    const mark = path.match(/^\/habits\/([^/]+)\/complete$/)
    if (mark) {
      habitsDone.add(mark[1])
      return json({ xp_earned: 20, new_xp: 120, new_level: 1, title: 'Iniciado', leveled_up: false, streak: 7, achievements_unlocked: [] })
    }
    return new Response(null, { status: 404 })
  }))
}

type Home = ReturnType<typeof import('./home').useHome>

/** Un arranque de la app: módulos nuevos (React incluido, para que los hooks sean del mismo), lo mismo en disco. */
async function start() {
  vi.resetModules()
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClientProvider } = await import('@tanstack/react-query')
  const q = await import('./queryClient')
  const sync = await import('./sync')
  const client = await import('./client')
  const home = await import('./home')
  const habits = await import('./habits')
  q.queryClient.mount()
  await sync.bootSync()
  await client.loadToken()
  sync.setAuthorized(true)

  const seen: { home: Home | null; habitsView: Habit[] } = { home: null, habitsView: [] }
  function Probe() {
    seen.home = home.useHome()
    // lo que ve la vista Hábitos: el mismo hook
    seen.habitsView = habits.useHabits(false).habits
    return null
  }
  const root = createRoot(document.createElement('div'))
  await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: q.queryClient }, React.createElement(Probe))))
  const settle = () => React.act(() => vi.advanceTimersByTimeAsync(10))
  return {
    q, habits, root, settle,
    home: () => seen.home!,
    habitsView: () => seen.habitsView,
    act: React.act,
    stop: () => React.act(() => root.unmount()),
  }
}

const goOnline = async (s: { settle: () => Promise<unknown> }) => {
  net.connected = true
  net.listener?.({ connected: true })
  for (let i = 0; i < 5; i++) await s.settle()
}
const goOffline = async (s: { settle: () => Promise<unknown> }) => {
  net.connected = false
  net.listener?.({ connected: false })
  await s.settle()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-03-02T17:00:00Z'))
  disk.clear()
  net.connected = true
  net.listener = null
  stubServer()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('un hábito marcado sin conexión desde el Inicio sube «X de N» en el Inicio y en Hábitos; el XP no se adelanta; sale un solo POST', async () => {
  const s = await start()
  for (let i = 0; i < 5; i++) await s.settle()
  expect(s.home()).toMatchObject({ habitsDone: 0, habitsTotal: 2, xpToday: 20, notice: null })
  expect(s.home().user?.xp).toBe(100)

  await goOffline(s)
  await s.act(async () => s.habits.habitActions.complete(LEER))
  await s.settle()
  // lo que el dispositivo sabe se adelanta
  expect(s.home().habitsDone).toBe(1)
  expect(s.habitsView().find((h) => h.id === LEER.id)?.done_today).toBe(true)
  expect(s.home().notice).toBe('sin conexión · 1 pendiente')
  // lo que decide el servidor, no
  expect(s.home().user).toMatchObject({ xp: 100, level: 1, xp_into_level: 100 })
  expect(s.home().xpToday).toBe(20)
  // la racha del bono es la de Hábitos (la del servidor): 6, sin bono, aunque la marca la llevaría a 7
  expect(s.habitsView().find((h) => h.id === LEER.id)?.streak).toBe(6)
  expect(s.home().streakBonus).toBe(1)
  expect(calls.filter((c) => c.method === 'POST')).toEqual([])

  await goOnline(s)
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([`/habits/${LEER.id}/complete`])
  expect(s.home().notice).toBeNull()
  await s.stop()
})

test('arranque sin señal con caché: el Inicio se pinta con lo de disco', async () => {
  const first = await start()
  for (let i = 0; i < 5; i++) await first.settle()
  await first.act(() => vi.advanceTimersByTimeAsync(3000)) // la caché se escribe 2 s después
  await first.stop()

  net.connected = false
  const before = calls.length
  const second = await start()
  await second.settle()
  expect(calls.length).toBe(before) // nada salió a la red
  expect(second.home().user?.xp).toBe(100)
  expect(second.home().habitsTotal).toBe(2)
  expect(second.home().groups.map((g) => g.category)).toEqual(['Mente', 'Salud'])
  expect(second.home().xpToday).toBe(20)
  expect(second.home().notice).toBe('sin conexión')
  await second.stop()
})

test('«hoy» cambia a medianoche aunque nada redibuje: el resumen pasa al día nuevo', async () => {
  vi.setSystemTime(new Date('2026-03-03T04:58:00Z')) // 23:58 del 02 en Bogotá
  const s = await start()
  for (let i = 0; i < 5; i++) await s.settle()
  expect(s.home().today).toBe('2026-03-02')
  expect(calls.some((c) => c.path === '/diary/2026-03-02')).toBe(true)

  await s.act(() => vi.advanceTimersByTimeAsync(3 * 60_000)) // 00:01 del 03
  for (let i = 0; i < 5; i++) await s.settle()
  expect(s.home().today).toBe('2026-03-03')
  expect(calls.some((c) => c.path === '/diary/2026-03-03')).toBe(true)
  await s.stop()
})
