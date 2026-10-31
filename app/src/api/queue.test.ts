import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { applyQueue } from './habits'
import { summarizeResults } from './user'
import type { Habit } from '../types'

/** Sobrevive a `vi.resetModules()`: es el disco. */
const disk = vi.hoisted(() => new Map<string, string>())
const net = vi.hoisted(() => ({ connected: false, listener: null as null | ((s: { connected: boolean }) => void) }))
const token = vi.hoisted(() => ({ value: 'tok' as string | null }))

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
  SecureStorage: {
    get: async () => token.value,
    set: async (_: string, v: string) => { token.value = v },
    remove: async () => { token.value = null },
  },
}))

const H = { id: '019a0000-0000-7000-8000-000000000001', name: 'Leer' }
const QUEUE_KEY = 'grimoire-queue-v1'

type Handler = (method: string, path: string) => { status: number; body?: unknown }
const okMark = { xp_earned: 20, new_xp: 20, new_level: 1, title: 'x', leveled_up: false, streak: 1, achievements_unlocked: [] }
const ok: Handler = () => ({ status: 200, body: okMark })

let calls: { method: string; path: string; body: unknown }[]

function stubFetch(handler: Handler) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    calls.push({ method: init.method!, path, body: init.body ? JSON.parse(init.body as string) : undefined })
    const { status, body } = handler(init.method!, path)
    return new Response(body === undefined ? null : JSON.stringify(body), { status })
  }))
}

/** Un arranque de la app: módulos nuevos, lo mismo en disco. */
async function start() {
  vi.resetModules()
  const q = await import('./queryClient')
  const sync = await import('./sync')
  const client = await import('./client')
  const { habitRequests } = await import('./habits')
  q.queryClient.mount()
  await sync.bootSync()
  await client.loadToken()
  sync.setAuthorized(token.value !== null)
  return { q, sync, client, habitRequests }
}

const settle = () => vi.advanceTimersByTimeAsync(10)
const statuses = (q: Awaited<ReturnType<typeof start>>['q']) =>
  q.queryClient.getMutationCache().getAll().map((m) => m.state.status)
const goOnline = async () => {
  net.connected = true
  net.listener?.({ connected: true })
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  net.connected = false
  net.listener = null
  token.value = 'tok'
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('marcar y deshacer la misma marca sin conexión sale en orden, con el id del cliente', async () => {
  stubFetch(ok)
  const { q, habitRequests } = await start()
  const mark = habitRequests.complete(H)
  const markId = (mark.body as { id: string }).id
  q.enqueue(mark)
  q.enqueue(habitRequests.undo(H, markId))
  await settle()
  expect(calls).toEqual([])

  await goOnline()
  await settle()
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    `POST /habits/${H.id}/complete`,
    `DELETE /habits/${H.id}/marks/${markId}`,
  ])
  expect(calls[0].body).toMatchObject({ id: markId })
})

test('la cola se restaura tras reiniciar, con el día de la marca y en orden', async () => {
  stubFetch(ok)
  vi.setSystemTime(new Date('2026-10-31T17:00:00Z'))
  const first = await start()
  const a = first.habitRequests.complete(H)
  const b = first.habitRequests.update(H, { name: 'Leer más' })
  first.q.enqueue(a)
  first.q.enqueue(b)
  await settle()
  first.q.queryClient.unmount()

  // al día siguiente, otro proceso
  vi.setSystemTime(new Date('2026-11-01T17:00:00Z'))
  await start()
  await settle()
  expect(calls).toEqual([])
  await goOnline()
  await settle()
  expect(calls.map((c) => c.path)).toEqual([a.path, b.path])
  expect(calls[0].body).toEqual(a.body)
  expect(calls[0].body).toMatchObject({ local_date: '2026-10-31' })
})

test('lo que iba en vuelo al cerrar también se restaura', async () => {
  // la respuesta nunca llega
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  net.connected = true
  const first = await start()
  const mark = first.habitRequests.complete(H)
  first.q.enqueue(mark)
  await settle()
  expect(first.q.queryClient.getMutationCache().getAll()[0].state.isPaused).toBe(false)
  first.q.queryClient.unmount()

  stubFetch(ok)
  net.connected = false
  await start()
  await goOnline()
  await settle()
  expect(calls.map((c) => c.body)).toEqual([mark.body])
})

test('un 409 al sincronizar se muestra, queda hasta descartarlo y no frena la cola', async () => {
  stubFetch((_, path) => path.endsWith('/complete')
    ? { status: 409, body: { detail: 'Solo se puede marcar hoy, ayer o anteayer' } }
    : { status: 200, body: {} })
  const first = await start()
  const errors: string[] = []
  first.q.onApiError((m) => errors.push(m))
  first.q.enqueue(first.habitRequests.complete(H))
  first.q.enqueue(first.habitRequests.update(H, { name: 'x' }))
  await goOnline()
  await settle()
  expect(calls).toHaveLength(2)
  expect(errors[0]).toContain('Marcar Leer')
  expect(errors[0]).toContain('Solo se puede marcar hoy, ayer o anteayer')
  expect(statuses(first.q)).toEqual(['error'])
  first.q.queryClient.unmount()

  // el rechazo sobrevive a reiniciar, con su mensaje, y no se vuelve a mandar
  const second = await start()
  calls = []
  await goOnline()
  await settle()
  expect(calls).toEqual([])
  const [m] = second.q.queryClient.getMutationCache().getAll()
  expect(m.state.status).toBe('error')
  expect((m.state.error as Error).message).toBe('Solo se puede marcar hoy, ayer o anteayer')

  second.q.dismissQueueEntry(m.mutationId)
  await settle()
  expect(JSON.parse(disk.get(QUEUE_KEY)!)).toEqual([])
})

test('un 401 no pierde la cola: se pausa y sigue con un token válido', async () => {
  let valid = false
  stubFetch(() => (valid ? { status: 200, body: okMark } : { status: 401, body: { detail: 'Token inválido' } }))
  const { q, sync, client, habitRequests } = await start()
  // lo que hace TokenGate
  client.onUnauthorized(() => sync.setAuthorized(false))
  const a = habitRequests.complete(H)
  const b = habitRequests.update(H, { name: 'x' })
  q.enqueue(a)
  q.enqueue(b)
  await goOnline()
  await vi.advanceTimersByTimeAsync(5000)

  expect(token.value).toBeNull()
  expect(calls).toHaveLength(1) // pausada: no insiste sin token
  expect(statuses(q)).toEqual(['pending', 'pending'])
  expect(JSON.parse(disk.get(QUEUE_KEY)!)).toHaveLength(2)

  valid = true
  calls = []
  await client.saveToken('nuevo')
  sync.setAuthorized(true)
  await settle()
  await settle()
  expect(calls.map((c) => c.path)).toEqual([a.path, b.path])
  expect(calls[0].body).toEqual(a.body)
})

test('un fallo de red no descarta: reintenta más allá de los 2 fallos y conserva el id', async () => {
  let fails = 5
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (_: string, init: RequestInit) => {
    calls.push({ method: init.method!, path: '', body: JSON.parse(init.body as string) })
    if (fails-- > 0) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(okMark), { status: 200 })
  }))
  net.connected = true
  const { q, habitRequests } = await start()
  const mark = habitRequests.complete(H)
  q.enqueue(mark)
  await vi.advanceTimersByTimeAsync(120_000)
  expect(calls).toHaveLength(6)
  expect(new Set(calls.map((c) => (c.body as { id: string }).id)).size).toBe(1)
  expect(q.queryClient.getMutationCache().getAll()).toEqual([])
})

test('un 5xx persistente avisa una vez y sigue en cola', async () => {
  stubFetch(() => ({ status: 503, body: {} }))
  net.connected = true
  const { q, habitRequests } = await start()
  const errors: string[] = []
  q.onApiError((m) => errors.push(m))
  q.enqueue(habitRequests.complete(H))
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  expect(errors).toEqual(['El servidor sigue fallando; tus cambios siguen guardados'])
  expect(statuses(q)).toEqual(['pending'])
})

test('vaciar la cola invalida una sola vez y entrega un solo lote de resultados', async () => {
  stubFetch(ok)
  const { q, habitRequests } = await start()
  const spy = vi.spyOn(q.queryClient, 'invalidateQueries')
  const batches: unknown[][] = []
  q.onSyncResults((r) => batches.push(r))
  for (let i = 0; i < 4; i++) q.enqueue(habitRequests.complete({ ...H, id: `h${i}` }))
  await goOnline()
  await settle()
  expect(calls).toHaveLength(4)
  expect(spy.mock.calls.filter((c) => c.length === 0 || c[0] === undefined)).toHaveLength(1)
  expect(batches).toHaveLength(1)
  expect(batches[0]).toHaveLength(4)
  expect(q.queryClient.getMutationCache().getAll()).toEqual([])
})

test('un resultado que llega antes de que haya pantalla no se pierde', async () => {
  stubFetch(ok)
  const first = await start()
  first.q.enqueue(first.habitRequests.complete(H))
  first.q.queryClient.unmount()
  const { q } = await start()
  await goOnline()
  await settle()
  const got: unknown[][] = []
  q.onSyncResults((r) => got.push(r))
  expect(got[0]).toHaveLength(1)
})

// ---------- Funciones puras ----------

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h', name: 'Leer', category: 'Otro', frequency: 'daily', days: null, target_per_week: 1,
  xp_reward: 20, color: '#000000', active: true, notes: null, tags: null, created_at: '2026-01-01T05:00:00Z',
  streak: 3, completion_rate: 50, done_today: false, last_mark: null, ...over,
})
const TODAY = '2026-10-31'
const entry = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, status: 'pending' | 'success' | 'error' = 'pending') =>
  ({ request: { method, path, body }, status })

test('una marca pendiente se ve hecha, y la racha sigue siendo la del servidor', () => {
  const { habits, pendingIds } = applyQueue([habit()], [entry('POST', '/habits/h/complete', { id: 'm', local_date: TODAY })], TODAY, false)
  expect(habits[0]).toMatchObject({ done_today: true, last_mark: { id: 'm', local_date: TODAY }, streak: 3 })
  expect(pendingIds.has('h')).toBe(true)
})

test('marcar y deshacer sin conexión deja el hábito como estaba', () => {
  const { habits } = applyQueue([habit()], [
    entry('POST', '/habits/h/complete', { id: 'm', local_date: TODAY }),
    entry('DELETE', '/habits/h/marks/m'),
  ], TODAY, false)
  expect(habits[0]).toMatchObject({ done_today: false, last_mark: null })
})

test('una marca de ayer aún en cola no cuenta como hecha hoy', () => {
  const { habits } = applyQueue([habit()], [entry('POST', '/habits/h/complete', { id: 'm', local_date: '2026-10-30' })], TODAY, false)
  expect(habits[0].done_today).toBe(false)
})

test('lo rechazado no se superpone; lo exitoso sí hasta el refresco, sin marcar pendiente', () => {
  const body = { id: 'm', local_date: TODAY }
  expect(applyQueue([habit()], [entry('POST', '/habits/h/complete', body, 'error')], TODAY, false).habits[0].done_today).toBe(false)
  const ok = applyQueue([habit()], [entry('POST', '/habits/h/complete', body, 'success')], TODAY, false)
  expect(ok.habits[0].done_today).toBe(true)
  expect(ok.pendingIds.size).toBe(0)
})

test('crear, editar y archivar se ven sin esperar al servidor', () => {
  const created = applyQueue([], [entry('POST', '/habits', { id: 'n', name: 'Nuevo', category: 'Otro' })], TODAY, false)
  expect(created.habits[0]).toMatchObject({ id: 'n', name: 'Nuevo', active: true, streak: 0 })
  expect(created.pendingIds.has('n')).toBe(true)
  expect(applyQueue([habit()], [entry('PATCH', '/habits/h', { name: 'Otro' })], TODAY, false).habits[0].name).toBe('Otro')
  expect(applyQueue([habit()], [entry('DELETE', '/habits/h')], TODAY, false).habits).toEqual([])
  expect(applyQueue([habit()], [entry('DELETE', '/habits/h')], TODAY, true).habits[0].active).toBe(false)
})

test('un lote: un resumen de lo tardío, cada logro y el ascenso más alto', () => {
  const r = (over: object, ageMs: number) => ({ request: { method: 'POST' as const, path: '/x' }, data: { ...okMark, ...over }, ageMs })
  const s = summarizeResults([
    r({ achievements_unlocked: [{ key: 'a', name: 'A', icon: 'x' }], leveled_up: true, new_level: 2 }, 90_000_000),
    r({ achievements_unlocked: [{ key: 'b', name: 'B', icon: 'x' }], leveled_up: true, new_level: 3 }, 90_000_000),
    r({ xp_earned: -20 }, 90_000_000),
    r({}, 90_000_000),
  ])
  expect(s.burst).toBe(false)
  expect(s.level?.new_level).toBe(3)
  expect(s.achievements.map((a) => a.key)).toEqual(['a', 'b'])
  expect(s).toMatchObject({ syncedMarks: 2, syncedXp: 40 })
  expect(summarizeResults([r({}, 100)])).toMatchObject({ burst: true, syncedMarks: 0 })
  expect(summarizeResults([{ request: { method: 'PATCH', path: '/x' }, data: { name: 'x' }, ageMs: 100 }]).burst).toBe(false)
})
