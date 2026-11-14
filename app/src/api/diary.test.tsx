// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DiaryDay, DiaryVolume } from '../types'
import { applyDiaryQueue, applyVolumeQueue, dayKey, diaryRequests, IDLE_SAVE_MS, useDiaryEditor } from './diary'
import { queryClient as sharedClient } from './queryClient'
import { persistedQuery } from './sync'
import { summarizeResults, syncedSummary } from './user'

/** Sobrevive a `vi.resetModules()`: es el disco. */
const disk = vi.hoisted(() => new Map<string, string>())
const net = vi.hoisted(() => ({ connected: false, listener: null as null | ((s: { connected: boolean }) => void) }))
const app = vi.hoisted(() => ({ pause: [] as (() => void)[] }))

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
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, fn: () => void) => {
      if (event === 'pause') app.pause.push(fn)
      return Promise.resolve({ remove: () => { app.pause = app.pause.filter((f) => f !== fn) } })
    },
  },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DAY = '2026-03-02'
const DRAFTS_KEY = 'grimoire-diary-drafts-v1'

// ---------- Un servidor de mentira con la regla de la decisión 1 ----------

type Stored = { id: string; content: string; save_id: string; tags: string | null }
let server: Map<string, Stored>
let conflicts: { id: string; day: string; content: string }[]
let calls: { method: string; path: string; body: Record<string, unknown> | undefined }[]

function stubFetch() {
  server = new Map()
  conflicts = []
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method: init.method!, path, body })
    const day = path.slice('/diary/'.length)
    if (init.method === 'PUT') {
      const cur = server.get(day)
      if (cur?.save_id === body.save_id) return json({ entry: cur, conflicts: 0, xp_earned: 0 })
      if (cur && cur.save_id !== body.base_save_id && cur.content.trim() && cur.content !== body.content) {
        conflicts.push({ id: body.save_id, day, content: cur.content })
      }
      const next = { id: cur?.id ?? body.id, content: body.content, save_id: body.save_id, tags: 'tags' in body ? body.tags : cur?.tags ?? null }
      server.set(day, next)
      return json({
        entry: next, conflicts: conflicts.filter((c) => c.day === day).length,
        xp_earned: cur ? 0 : 5, new_xp: 5, new_level: 1, title: 'Iniciado', leveled_up: false, achievements_unlocked: [],
      })
    }
    if (init.method === 'DELETE') {
      conflicts = conflicts.filter((c) => !path.endsWith(c.id))
      return new Response(null, { status: 204 })
    }
    const cur = server.get(day)
    return json({
      entry: cur ? { ...cur, local_date: day, updated_at: 'x' } : { id: null, local_date: day, content: '', tags: null, save_id: null, updated_at: null },
      conflicts: conflicts.filter((c) => c.day === day).map((c) => ({ ...c, tags: null, created_at: 'x' })),
      summary: { habits_done: [], pomodoro_sessions: [], pomodoro_minutes: 0, xp_earned: 0 },
    })
  }))
}

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })

/** Un arranque de la app: módulos nuevos, lo mismo en disco. */
async function start() {
  vi.resetModules()
  const q = await import('./queryClient')
  const sync = await import('./sync')
  const client = await import('./client')
  const diary = await import('./diary')
  q.queryClient.mount()
  await sync.bootSync()
  await diary.bootDiary()
  await client.loadToken()
  sync.setAuthorized(true)
  return { q, diary }
}

const settle = () => vi.advanceTimersByTimeAsync(10)
const goOnline = async () => {
  net.connected = true
  net.listener?.({ connected: true })
  for (let i = 0; i < 5; i++) await settle()
}
type Q = Awaited<ReturnType<typeof start>>['q']
const queued = (q: Q) =>
  q.queryClient.getMutationCache().getAll().map((m) => m.state.variables as { method: string; path: string; body: Record<string, unknown> })
const puts = () => calls.filter((c) => c.method === 'PUT')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-02T17:00:00Z'))
  disk.clear()
  net.connected = false
  net.listener = null
  app.pause = []
  stubFetch()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------- Arranques ----------

test('escribir sin conexión y cerrar antes de guardar: al abrir, el borrador sale en un solo PUT', async () => {
  const first = await start()
  first.diary.setDraft(DAY, { content: 'Escrito sin señal' })
  await vi.advanceTimersByTimeAsync(1000) // el borrador llega a disco; la app muere sin encolar
  expect(JSON.parse(disk.get(DRAFTS_KEY)!)).toEqual({ [DAY]: { content: 'Escrito sin señal' } })
  expect(queued(first.q)).toEqual([])
  first.q.queryClient.unmount()

  const second = await start()
  expect(queued(second.q).map((r) => r.body.content)).toEqual(['Escrito sin señal'])
  expect(JSON.parse(disk.get(DRAFTS_KEY)!)).toEqual({}) // ya está en la cola en disco
  second.q.queryClient.unmount()

  // otro arranque antes de tener señal: ni se pierde ni se duplica
  const third = await start()
  expect(queued(third.q)).toHaveLength(1)
  await goOnline()
  expect(puts()).toHaveLength(1)
  expect(puts()[0].body).toMatchObject({ content: 'Escrito sin señal', base_save_id: null })
  expect(server.get(DAY)?.content).toBe('Escrito sin señal')
})

test('tres guardados sin señal encadenan su base y no dan conflicto consigo mismos', async () => {
  const { q, diary } = await start()
  for (const content of ['Uno', 'Uno, dos', 'Uno, dos, tres']) await diary.commitDiary(DAY, { content })
  const bodies = queued(q).map((r) => r.body)
  expect(bodies.map((b) => b.base_save_id)).toEqual([null, bodies[0].save_id, bodies[1].save_id])
  expect(new Set(bodies.map((b) => b.id)).size).toBe(1)
  await goOnline()
  expect(server.get(DAY)?.content).toBe('Uno, dos, tres')
  expect(conflicts).toEqual([])
})

test('guardar lo mismo que ya está no encola y borra el borrador', async () => {
  const { q, diary } = await start()
  q.queryClient.setQueryData(dayKey(DAY), day({ content: 'Igual', save_id: 's0' }))
  diary.setDraft(DAY, { content: 'Igual' })
  await diary.commitDiary(DAY, { content: 'Igual' })
  expect(queued(q)).toEqual([])
  expect(diary.draftFor(DAY)).toBeUndefined()
})

test('el teléfono sin caché escribe sobre lo del PC: la copia aparece en el día y descartarla la oculta', async () => {
  server.set(DAY, { id: 'e-pc', content: 'Escrito en el PC', save_id: 'pc', tags: null })
  const { q, diary } = await start()
  await diary.commitDiary(DAY, { content: 'Escrito en el teléfono' })
  expect(queued(q)[0].body).toMatchObject({ base_save_id: null })
  await goOnline()
  expect(server.get(DAY)).toMatchObject({ id: 'e-pc', content: 'Escrito en el teléfono' })

  const fetched = await q.queryClient.fetchQuery({ queryKey: dayKey(DAY), queryFn: () => fetch('https://x/diary/' + DAY, { method: 'GET' }).then((r) => r.json()) })
  const view = applyDiaryQueue(fetched as DiaryDay, [], DAY)
  expect(view.conflicts.map((c) => c.content)).toEqual(['Escrito en el PC'])

  const discard = diaryRequests.discardConflict(view.conflicts[0].id)
  expect(applyDiaryQueue(fetched as DiaryDay, [{ request: discard, status: 'pending' }], DAY).conflicts).toEqual([])
})

// ---------- Vista derivada ----------

function day(entry: Partial<DiaryDay['entry']> = {}): DiaryDay {
  return {
    entry: { id: 'e1', local_date: DAY, content: '', tags: null, save_id: null, updated_at: null, ...entry },
    conflicts: [],
    summary: { habits_done: [], pomodoro_sessions: [], pomodoro_minutes: 0, xp_earned: 0 },
  }
}

test('lo último en cola manda; un guardado rechazado no; etiquetas omitidas se conservan', () => {
  const a = diaryRequests.save(DAY, 'e1', 's0', { content: 'A', tags: 'foco' })
  const b = diaryRequests.save(DAY, 'e1', (a.body as { save_id: string }).save_id, { content: 'B' })
  const bad = diaryRequests.save(DAY, 'e1', 'x', { content: 'Rechazado' })
  const view = applyDiaryQueue(day({ content: 'Servidor', save_id: 's0' }), [
    { request: a, status: 'success' },
    { request: b, status: 'pending' },
    { request: bad, status: 'error' },
  ], DAY)
  expect(view.entry).toMatchObject({ content: 'B', tags: 'foco', save_id: (b.body as { save_id: string }).save_id })
  expect(view.pending).toBe(true)
  // un guardado de otro día no toca este
  const other = diaryRequests.save('2026-03-03', 'e2', null, { content: 'Otro' })
  expect(applyDiaryQueue(day({ content: 'Servidor' }), [{ request: other, status: 'pending' }], DAY).entry.content).toBe('Servidor')
})

test('el volumen suma lo escrito en cola y quita lo vaciado', () => {
  const vol: DiaryVolume = { points: [{ local_date: '2026-03-01', length: 4 }], total: 10 }
  const add = diaryRequests.save(DAY, 'e1', null, { content: 'Café' })
  const empty = diaryRequests.save('2026-03-01', 'e0', 's', { content: '  \n' })
  expect(applyVolumeQueue(vol, [{ request: add, status: 'pending' }])).toEqual({
    points: [{ local_date: '2026-03-01', length: 4 }, { local_date: DAY, length: 4 }], total: 11,
  })
  expect(applyVolumeQueue(vol, [{ request: empty, status: 'pending' }])).toEqual({ points: [], total: 9 })
})

test('en disco van los días abiertos de los últimos 7 y el volumen, no la búsqueda', () => {
  const now = Date.parse('2026-03-02T17:00:00Z')
  expect(persistedQuery(['diary', 'day', '2026-03-02'], now)).toBe(true)
  expect(persistedQuery(['diary', 'day', '2026-02-24'], now)).toBe(true)
  expect(persistedQuery(['diary', 'day', '2026-02-23'], now)).toBe(false)
  expect(persistedQuery(['diary', 'day', '2026-03-03'], now)).toBe(false)
  expect(persistedQuery(['diary', 'volume'], now)).toBe(true)
  expect(persistedQuery(['diary', 'search', 'x'], now)).toBe(false)
})

test('una entrada sincronizada tarde cuenta como entrada, no como marca', () => {
  const request = diaryRequests.save(DAY, 'e1', null, { content: 'Hola' })
  const data = { xp_earned: 5, new_xp: 5, new_level: 1, title: 'x', leveled_up: false, achievements_unlocked: [] }
  const rewrite = { ...data, xp_earned: 0 }
  const s = summarizeResults([
    { request, data, ageMs: 60_000 },
    { request, data: rewrite, ageMs: 60_000 },
  ])
  expect(syncedSummary(s)).toBe('1 entrada · +5 XP')
})

// ---------- Editor ----------

type Editor = ReturnType<typeof useDiaryEditor>

test('el editor guarda al cambiar de día, al pasar a segundo plano y tras 30 s sin teclear', async () => {
  // `onlineManager` es de query-core, que `vi.resetModules` no reinicia: un arranque anterior lo dejó
  // en línea. Sin conexión, lo guardado se queda en la cola y se puede mirar.
  onlineManager.setOnline(false)
  sharedClient.clear()
  sharedClient.setQueryData(dayKey(DAY), day({ id: 'e1', content: 'Del servidor', save_id: 's0' }))
  sharedClient.setQueryData(dayKey('2026-03-03'), day({ id: null, local_date: '2026-03-03' }))
  let ed: Editor | null = null
  let setDay: (d: string) => void = () => {}
  function Probe() {
    const [d, set] = useState(DAY)
    setDay = set
    ed = useDiaryEditor(d)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<QueryClientProvider client={sharedClient}><Probe /></QueryClientProvider>))
  const editor = () => ed as unknown as Editor
  const saves = () => sharedClient.getMutationCache().getAll()
    .map((m) => m.state.variables as { path: string; body: Record<string, unknown> })
    .filter((r) => r?.path.startsWith('/diary/2026'))

  expect(editor().content).toBe('Del servidor')
  expect(editor().status).toBe('saved')
  await act(async () => editor().setContent('Del servidor, y más'))
  expect(editor().status).toBe('editing')
  expect(saves()).toEqual([])

  // cambiar de día guarda el anterior, con su id y su base
  await act(async () => setDay('2026-03-03'))
  await act(() => vi.advanceTimersByTimeAsync(10))
  expect(saves().map((r) => [r.path, r.body.content, r.body.id, r.body.base_save_id])).toEqual([
    [`/diary/${DAY}`, 'Del servidor, y más', 'e1', 's0'],
  ])
  expect(editor().content).toBe('')

  // segundo plano
  await act(async () => editor().setContent('Nuevo día'))
  await act(async () => app.pause.forEach((fn) => fn()))
  await act(() => vi.advanceTimersByTimeAsync(10))
  expect(saves().at(-1)!.body).toMatchObject({ content: 'Nuevo día', base_save_id: null })
  expect(editor().status).toBe('queued')

  // 30 s sin teclear, encadenado al anterior
  const base = saves().at(-1)!.body.save_id
  await act(async () => editor().setContent('Nuevo día, sigue'))
  await act(() => vi.advanceTimersByTimeAsync(IDLE_SAVE_MS - 100))
  expect(saves()).toHaveLength(2)
  await act(() => vi.advanceTimersByTimeAsync(200))
  expect(saves().at(-1)!.body).toMatchObject({ content: 'Nuevo día, sigue', base_save_id: base })

  // las etiquetas se guardan al cambiar
  await act(async () => editor().setTags('foco'))
  await act(() => vi.advanceTimersByTimeAsync(10))
  expect(saves().at(-1)!.body).toMatchObject({ content: 'Nuevo día, sigue', tags: 'foco' })
  expect(saves()).toHaveLength(4)
  act(() => root.unmount())
})
