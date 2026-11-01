import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { applyQueue } from './habits'
import { applyProjectQueue, projectRequests } from './projects'
import { applyTaskQueue, rankAtEnd, rankBetween, remindAtToLocal, remindAtToUtc, sortTasks, stepNeighbours, taskRequests } from './tasks'
import { summarizeResults, syncedSummary } from './user'
import type { ApiChecklistItem, ApiProject, ApiTask } from '../types'

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

type Call = { method: string; path: string; body: Record<string, unknown> }
let calls: Call[]

function stubFetch(handler: (c: Call) => { status: number; body?: unknown } = () => ({ status: 200, body: {} })) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const call = {
      method: init.method!,
      path: url.replace(/^https?:\/\/[^/]+/, ''),
      body: init.body ? JSON.parse(init.body as string) : undefined,
    }
    calls.push(call)
    const { status, body } = handler(call)
    return new Response(body === undefined ? null : JSON.stringify(body), { status })
  }))
}

/** Un arranque de la app: módulos nuevos, lo mismo en disco. */
async function start() {
  vi.resetModules()
  const q = await import('./queryClient')
  const sync = await import('./sync')
  const client = await import('./client')
  q.queryClient.mount()
  await sync.bootSync()
  await client.loadToken()
  sync.setAuthorized(true)
  return q
}

type Queue = Awaited<ReturnType<typeof start>>

/** La cola tal como la ve una pantalla. */
const queued = (q: Queue) =>
  q.queryClient.getMutationCache().getAll().map((m) => ({
    request: m.state.variables as Call & { method: 'POST' | 'PATCH' | 'DELETE' },
    status: m.state.status,
  }))

const settle = () => vi.advanceTimersByTimeAsync(10)
const goOnline = async () => {
  net.connected = true
  net.listener?.({ connected: true })
  await settle()
  await settle()
}
const sent = () => calls.map((c) => `${c.method} ${c.path}`)

const task = (over: Partial<ApiTask> = {}): ApiTask => ({
  id: 't', title: 'Leer', description: null, category: null, priority: 'medium', project_id: null, due_date: null,
  xp_reward: 15, status: 'todo', rank: 'V', grant_id: null, completed: false, completed_at: null, completed_on: null,
  remind_at: null, tags: null, created_at: '2026-01-01T05:00:00Z', checklist: [], checklist_done: 0,
  checklist_total: 0, ...over,
})
const item = (over: Partial<ApiChecklistItem> = {}): ApiChecklistItem => ({
  id: 'i', task_id: 't', text: 'Paso', done: false, position: 0, ...over,
})
const entry = (request: { method: 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown }, status: 'pending' | 'success' | 'error' = 'pending') =>
  ({ request, status })

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  net.connected = false
  net.listener = null
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------- Con la cola de verdad, en arranques simulados ----------

test('mover dos veces la misma tarjeta sin conexión: en orden, tras reiniciar, y gana el último', async () => {
  stubFetch()
  const first = await start()
  const base = task({ id: 'a', rank: 'V' })
  const a = taskRequests.move(base, 'doing', rankBetween('M', 'P'))
  first.enqueue(a)
  const moved = applyTaskQueue([base], queued(first)).tasks[0]
  expect(moved).toMatchObject({ status: 'doing', rank: (a.body as { rank: string }).rank })
  const b = taskRequests.move(moved, 'todo', rankBetween('c', 'e'))
  first.enqueue(b)
  await settle()
  expect(calls).toEqual([])
  first.queryClient.unmount()

  const second = await start()
  const view = applyTaskQueue([base], queued(second)).tasks[0]
  expect(view).toMatchObject({ status: 'todo', rank: (b.body as { rank: string }).rank })
  await goOnline()
  expect(sent()).toEqual(['PATCH /tasks/a', 'PATCH /tasks/a'])
  expect(calls.map((c) => c.body)).toEqual([a.body, b.body])
  // cada `move` lleva solo una clave ya calculada: repetirla no calcula otra
  expect(new Set(calls.map((c) => c.body.rank)).size).toBe(2)
})

test('completar y descompletar sin señal: la concesión viaja del uno al otro, en orden', async () => {
  stubFetch()
  const first = await start()
  const base = task()
  const c = taskRequests.complete(base)
  first.enqueue(c)
  const done = applyTaskQueue([base], queued(first)).tasks[0]
  const grant = (c.body as { id: string }).id
  expect(done).toMatchObject({ status: 'done', completed: true, grant_id: grant })

  first.enqueue(taskRequests.uncomplete(done))
  expect(applyTaskQueue([base], queued(first)).tasks[0]).toMatchObject({
    status: 'todo', completed: false, grant_id: null, completed_on: null,
  })
  await settle()
  expect(calls).toEqual([])
  first.queryClient.unmount()

  await start()
  await goOnline()
  expect(sent()).toEqual(['POST /tasks/t/complete', 'POST /tasks/t/uncomplete'])
  expect(calls[0].body.id).toBe(grant)
  expect(calls[1].body.grant_id).toBe(grant)
})

test('completar conserva el día en que se tocó, aunque sincronice después', async () => {
  stubFetch()
  vi.setSystemTime(new Date('2026-10-31T17:00:00Z'))
  const first = await start()
  first.enqueue(taskRequests.complete(task()))
  await settle()
  first.queryClient.unmount()
  vi.setSystemTime(new Date('2026-11-01T17:00:00Z'))
  await start()
  await goOnline()
  expect(calls[0].body.local_date).toBe('2026-10-31')
})

test('un proyecto, una tarea en él y su checklist creados sin conexión salen en orden', async () => {
  stubFetch()
  const first = await start()
  const p = projectRequests.create({ name: 'Tesis' })
  const projectId = (p.body as { id: string }).id
  const t = taskRequests.create({ title: 'Leer', project_id: projectId }, rankBetween(null, null))
  const taskId = (t.body as { id: string }).id
  first.enqueue(p)
  first.enqueue(t)
  first.enqueue(taskRequests.addItem(taskId, 'Uno'))
  first.enqueue(taskRequests.addItem(taskId, 'Dos'))
  await settle()

  const view = applyTaskQueue([], queued(first))
  expect(view.tasks[0]).toMatchObject({ id: taskId, project_id: projectId, checklist_total: 2 })
  expect(view.tasks[0].checklist.map((i) => [i.text, i.position])).toEqual([['Uno', 0], ['Dos', 1]])
  expect(view.pendingIds.has(taskId)).toBe(true)
  first.queryClient.unmount()

  await start()
  await goOnline()
  expect(sent()).toEqual(['POST /projects', 'POST /tasks', `POST /tasks/${taskId}/checklist`, `POST /tasks/${taskId}/checklist`])
  expect(calls[1].body).toEqual(t.body)
})

test('crear y borrar sin conexión no deja rastro en la vista y manda las dos', async () => {
  stubFetch()
  const q = await start()
  const t = taskRequests.create({ title: 'Leer' }, 'V')
  const id = (t.body as { id: string }).id
  q.enqueue(t)
  q.enqueue(taskRequests.remove({ id, title: 'Leer' }))
  expect(applyTaskQueue([], queued(q)).tasks).toEqual([])
  await goOnline()
  expect(sent()).toEqual(['POST /tasks', `DELETE /tasks/${id}`])
})

test('un 409 de completar en otro dispositivo se muestra, no se superpone y no frena la cola', async () => {
  stubFetch((c) => c.path.endsWith('/complete')
    ? { status: 409, body: { detail: 'La tarea ya está completada' } }
    : { status: 200, body: {} })
  const q = await start()
  const errors: string[] = []
  q.onApiError((m) => errors.push(m))
  const base = task()
  q.enqueue(taskRequests.complete(base))
  q.enqueue(taskRequests.update(base, { title: 'Otro' }))
  await goOnline()
  expect(calls).toHaveLength(2)
  expect(errors[0]).toContain('Completar Leer')
  expect(errors[0]).toContain('La tarea ya está completada')
  expect(applyTaskQueue([base], queued(q)).tasks[0].status).toBe('todo')
})

test('las tareas sobreviven al arranque sin señal, con la lista en disco', async () => {
  stubFetch()
  const first = await start()
  first.queryClient.setQueryData(['tasks', 'list'], [task()])
  first.queryClient.setQueryData(['projects'], [{ id: 'p' }])
  first.queryClient.setQueryData(['tasks', 'history'], { pages: [] })
  await vi.advanceTimersByTimeAsync(3000)
  first.queryClient.unmount()
  const second = await start()
  expect(second.queryClient.getQueryData(['tasks', 'list'])).toEqual([task()])
  expect(second.queryClient.getQueryData(['projects'])).toEqual([{ id: 'p' }])
  expect(second.queryClient.getQueryData(['tasks', 'history'])).toBeUndefined()
})

// ---------- rankBetween ----------

test('la clave queda entre sus vecinas, en cualquier punto de una lista que crece', () => {
  // semilla fija: si falla, vuelve a fallar igual
  let seed = 20261031
  const random = (n: number) => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return Math.floor((seed / 2 ** 32) * n)
  }
  const keys: string[] = []
  for (let n = 0; n < 10_000; n++) {
    const at = random(keys.length + 1)
    const a = keys[at - 1] ?? null
    const b = keys[at] ?? null
    const k = rankBetween(a, b)
    if (a !== null && !(a < k)) throw new Error(`${k} no es mayor que ${a}`)
    if (b !== null && !(k < b)) throw new Error(`${k} no es menor que ${b}`)
    if (!/^[0-9A-Za-z]+$/.test(k) || k.endsWith('0')) throw new Error(`clave inválida: ${k}`)
    keys.splice(at, 0, k)
  }
  expect([...keys].sort()).toEqual(keys)
  expect(new Set(keys).size).toBe(10_000)
})

test.each([
  ['al final', (k: string[]) => [k.at(-1)!, null] as const, 40],
  ['al principio', (k: string[]) => [null, k[0]] as const, 200],
  ['siempre en el mismo hueco', (k: string[]) => [k[0], k[1]] as const, 200],
])('mil inserciones %s: orden estricto y largo acotado', (_, around, maxLength) => {
  const keys = [rankBetween(null, null)]
  keys.push(rankBetween(keys[0], null))
  for (let n = 0; n < 1000; n++) {
    const [a, b] = around(keys)
    const k = rankBetween(a, b)
    if (a !== null && !(a < k)) throw new Error(`${k} <= ${a}`)
    if (b !== null && !(k < b)) throw new Error(`${k} >= ${b}`)
    if (a === null) keys.unshift(k)
    else if (b === null) keys.push(k)
    else keys.splice(1, 0, k)
  }
  expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(maxLength)
})

test('entre las claves de la v1 y de los seeds también cabe una', () => {
  for (const [a, b] of [['a00009', 'a00010'], ['a00010', 'a00011'], ['a0', 'a01'], ['Z', 'a'], ['0V', '1']]) {
    const k = rankBetween(a, b)
    expect(a < k && k < b, `${a} < ${k} < ${b}`).toBe(true)
  }
})

test('sin hueco posible no falla: queda justo después de la de abajo', () => {
  expect(rankBetween('V', 'V') > 'V').toBe(true)
  expect(rankBetween('a0', 'a00') > 'a0').toBe(true)
})

test('al final de una columna: después de la última de esa columna, no de las otras', () => {
  const tasks = [{ status: 'todo' as const, rank: 'M' }, { status: 'doing' as const, rank: 'x' }, { status: 'todo' as const, rank: 'c' }]
  const k = rankAtEnd(tasks, 'todo')
  expect(k > 'c' && k < 'x').toBe(true)
  expect(rankAtEnd([], 'done')).toBe(rankBetween(null, null))
})

// ---------- Las requests ----------

const G = '019a0000-0000-7000-8000-00000000000a'

test('soltar en cada columna manda la ruta que corresponde', () => {
  const open = task()
  const done = task({ status: 'done', grant_id: G })
  expect(taskRequests.move(open, 'doing', 'k')).toMatchObject({ method: 'PATCH', body: { status: 'doing', rank: 'k' } })
  // sin `status`: el servidor rechaza cambiarlo en una tarea hecha, y solo se reordena
  expect(taskRequests.move(open, 'todo', 'k').body).toEqual({ rank: 'k' })
  expect(taskRequests.move(done, 'done', 'k').body).toEqual({ rank: 'k' })
  const c = taskRequests.move(open, 'done', 'k')
  expect(c.path).toBe('/tasks/t/complete')
  expect(c.body).toMatchObject({ rank: 'k' })
  const u = taskRequests.move(done, 'doing', 'k')
  expect(u.path).toBe('/tasks/t/uncomplete')
  expect(u.body).toEqual({ grant_id: G, status: 'doing', rank: 'k' })
})

test('los ids nacen una sola vez, distintos en cada request', () => {
  const ids = [taskRequests.complete(task()), taskRequests.complete(task()), taskRequests.create({ title: 'x' }, 'V'), taskRequests.addItem('t', 'y')]
    .map((r) => (r.body as { id: string }).id)
  expect(new Set(ids).size).toBe(4)
})

test('descompletar una tarea migrada sin concesión manda null', () => {
  expect(taskRequests.uncomplete(task({ status: 'done' })).body).toEqual({ grant_id: null })
})

// ---------- La vista ----------

test('la vista sale en el orden del tablero, con el id desempatando', () => {
  const { tasks } = applyTaskQueue(
    [task({ id: 'b', rank: 'M' }), task({ id: 'a', rank: 'M' }), task({ id: 'c', rank: 'A' })],
    [entry({ method: 'PATCH', path: '/tasks/c', body: { rank: 'z' } })],
  )
  expect(tasks.map((t) => t.id)).toEqual(['a', 'b', 'c'])
})

test('lo rechazado no se superpone; lo exitoso sí, sin marcar pendiente', () => {
  const patch = { method: 'PATCH' as const, path: '/tasks/t', body: { title: 'Otro' } }
  expect(applyTaskQueue([task()], [entry(patch, 'error')]).tasks[0].title).toBe('Leer')
  const ok = applyTaskQueue([task()], [entry(patch, 'success')])
  expect(ok.tasks[0].title).toBe('Otro')
  expect(ok.pendingIds.size).toBe(0)
})

test('descompletar con una concesión que ya no es la vigente no reabre, igual que el servidor', () => {
  const done = task({ status: 'done', completed: true, grant_id: 'g2' })
  const stale = entry({ method: 'POST', path: '/tasks/t/uncomplete', body: { grant_id: 'g1' } })
  expect(applyTaskQueue([done], [stale]).tasks[0].status).toBe('done')
})

test('completar lo ya completado conserva la concesión vigente, igual que el servidor', () => {
  const done = task({ status: 'done', completed: true, grant_id: 'g1' })
  const again = entry({ method: 'POST', path: '/tasks/t/complete', body: { id: 'g2', local_date: '2026-10-31' } })
  expect(applyTaskQueue([done], [again]).tasks[0].grant_id).toBe('g1')
})

test('descompletar lleva a la columna y la clave pedidas; sin ellas, a todo', () => {
  const done = task({ status: 'done', completed: true, grant_id: 'g', rank: 'M' })
  const to = (body: object) => applyTaskQueue([done], [entry({ method: 'POST', path: '/tasks/t/uncomplete', body: { grant_id: 'g', ...body } })]).tasks[0]
  expect(to({ status: 'doing', rank: 'k' })).toMatchObject({ status: 'doing', rank: 'k' })
  expect(to({})).toMatchObject({ status: 'todo', rank: 'M' })
})

test('un PATCH con estado sobre una tarea hecha no la saca de done, igual que el servidor', () => {
  const done = task({ status: 'done', completed: true, grant_id: 'g' })
  const view = applyTaskQueue([done], [entry({ method: 'PATCH', path: '/tasks/t', body: { status: 'doing', rank: 'k' } })]).tasks[0]
  expect(view).toMatchObject({ status: 'done', rank: 'k' })
})

test('la checklist pendiente se ve: agregar, marcar y borrar, con sus conteos', () => {
  const base = task({ checklist: [item(), item({ id: 'j', position: 4 })], checklist_total: 2 })
  const v = applyTaskQueue([base], [
    entry({ method: 'POST', path: '/tasks/t/checklist', body: { id: 'n', text: 'Nuevo' } }),
    entry({ method: 'PATCH', path: '/tasks/checklist/i', body: { done: true } }),
    entry({ method: 'DELETE', path: '/tasks/checklist/j' }),
  ])
  expect(v.tasks[0].checklist.map((i) => [i.id, i.done, i.position])).toEqual([['i', true, 0], ['n', false, 5]])
  expect(v.tasks[0]).toMatchObject({ checklist_total: 2, checklist_done: 1 })
  expect(v.pendingIds.has('t')).toBe(true)
})

test('borrar un proyecto deja sus tareas sin proyecto, como ON DELETE SET NULL', () => {
  const { tasks } = applyTaskQueue(
    [task({ id: 'a', project_id: 'p' }), task({ id: 'b', project_id: 'q' })],
    [entry({ method: 'DELETE', path: '/projects/p' })],
  )
  expect(tasks.map((t) => t.project_id)).toEqual([null, 'q'])
})

test('descompletar desde el historial la pone en la lista al instante, también tras reiniciar', async () => {
  stubFetch()
  const old = task({ id: 'o', status: 'done', completed: true, grant_id: 'g', completed_on: '2026-01-01', project_id: 'p' })
  const first = await start()
  first.enqueue(taskRequests.uncompleteOlder(old))
  await settle()
  first.queryClient.unmount()

  const second = await start()
  expect(applyTaskQueue([], queued(second)).tasks[0]).toMatchObject({ id: 'o', status: 'todo', completed: false, grant_id: null })
  // ya contada como hecha: solo sube pendientes
  const [p] = applyProjectQueue([project()], queued(second), []).projects
  expect(p).toMatchObject({ tasks_total: 3, tasks_pending: 2 })
  await goOnline()
  expect(calls[0].body).toEqual({ grant_id: 'g' }) // la copia no viaja
})

test('descompletar desde el historial, si se rechaza, no cambia los conteos', () => {
  const old = task({ status: 'done', completed: true, grant_id: 'g', project_id: 'p' })
  const [p] = applyProjectQueue([project()], [entry(taskRequests.uncompleteOlder(old), 'error')], []).projects
  expect(p).toMatchObject({ tasks_total: 3, tasks_pending: 1 })
})

test('si el servidor ya trae la tarea descompletada, la copia no la duplica ni la pisa', () => {
  const old = task({ id: 'o', status: 'done', completed: true, grant_id: 'g', title: 'Vieja' })
  const e = entry({ ...taskRequests.uncompleteOlder(old) }, 'success')
  const { tasks } = applyTaskQueue([task({ id: 'o', title: 'Nueva' })], [e])
  expect(tasks.map((t) => t.title)).toEqual(['Nueva'])
})

test('los conteos de un proyecto siguen a la cola sin esperar al servidor', () => {
  const base = [task({ id: 'a', project_id: 'p' }), task({ id: 'd', project_id: 'p', status: 'done', completed: true, grant_id: 'g' })]
  const count = (...es: ReturnType<typeof entry>[]) => {
    const [p] = applyProjectQueue([project({ tasks_total: 5, tasks_pending: 1 })], es, base).projects
    return [p.tasks_total, p.tasks_pending]
  }
  const complete = entry({ method: 'POST', path: '/tasks/a/complete', body: { id: 'n', local_date: '2026-10-31' } })
  expect(count()).toEqual([5, 1])
  expect(count(complete)).toEqual([5, 0])
  expect(count(entry({ method: 'POST', path: '/tasks/d/uncomplete', body: { grant_id: 'g' } }))).toEqual([5, 2])
  expect(count(entry({ method: 'POST', path: '/tasks', body: { id: 'x', title: 'x', rank: 'V', project_id: 'p' } }))).toEqual([6, 2])
  expect(count(entry({ method: 'DELETE', path: '/tasks/a' }))).toEqual([4, 0])
  expect(count(entry({ method: 'PATCH', path: '/tasks/a', body: { project_id: 'q' } }))).toEqual([4, 0])
  // lo rechazado no cuenta, y lo ya sincronizado que el servidor trae no cuenta dos veces
  expect(count({ ...complete, status: 'error' })).toEqual([5, 1])
  const synced = entry({ method: 'POST', path: '/tasks', body: { id: 'a', title: 'x', rank: 'V', project_id: 'p' } }, 'success')
  expect(count(synced)).toEqual([5, 1])
})

test('el toast cuenta marcas y tareas por separado', () => {
  const r = (path: string, xp_earned: number) => ({ request: { method: 'POST' as const, path }, data: { xp_earned, new_level: 1, title: '', leveled_up: false, achievements_unlocked: [] }, ageMs: 90_000 })
  const say = (...rs: ReturnType<typeof r>[]) => syncedSummary(summarizeResults(rs))
  expect(say(r('/tasks/t/complete', 15))).toBe('1 tarea · +15 XP')
  expect(say(r('/habits/h/complete', 20), r('/habits/i/complete', 20), r('/tasks/t/complete', 15), r('/tasks/u/complete', 15))).toBe('2 marcas · 2 tareas · +70 XP')
  expect(say(r('/tasks/t/complete', 15), r('/tasks/t/uncomplete', -15))).toBeNull()
})

test('subir y bajar un puesto: entre qué vecinas cae, y el borde no se mueve', () => {
  const col = [{ id: 'a', rank: 'A' }, { id: 'b', rank: 'B' }, { id: 'c', rank: 'C' }, { id: 'd', rank: 'D' }]
  expect(stepNeighbours(col, 'c', -1)).toEqual(['A', 'B'])
  expect(stepNeighbours(col, 'b', 1)).toEqual(['C', 'D'])
  expect(stepNeighbours(col, 'b', -1)).toEqual([null, 'A'])
  expect(stepNeighbours(col, 'c', 1)).toEqual(['D', null])
  expect(stepNeighbours(col, 'a', -1)).toBeNull()
  expect(stepNeighbours(col, 'd', 1)).toBeNull()
})

test('los órdenes de la lista son los de la v1', () => {
  const list = [
    task({ id: 'sin', priority: 'high' }),
    task({ id: 'baja', priority: 'low', due_date: '2026-01-01' }),
    task({ id: 'alta', priority: 'high', due_date: '2026-06-01' }),
    task({ id: 'media', priority: 'medium', due_date: '2026-03-01' }),
  ]
  expect(sortTasks(list, 'priority').map((t) => t.id)).toEqual(['alta', 'sin', 'media', 'baja'])
  expect(sortTasks(list, 'due_date').map((t) => t.id)).toEqual(['baja', 'media', 'alta', 'sin'])
})

test('el recordatorio va en UTC sin milisegundos y vuelve a la hora del dispositivo', () => {
  expect(remindAtToUtc('')).toBeNull()
  const utc = remindAtToUtc('2026-11-02T08:30')!
  expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  expect(remindAtToLocal(utc)).toBe('2026-11-02T08:30')
  expect(remindAtToLocal(null)).toBe('')
})

// ---------- Una sola cola para todos los recursos ----------

test('cada vista ignora lo de los otros recursos', () => {
  const entries = [
    entry({ method: 'POST', path: '/tasks', body: { id: 't1', title: 'T', rank: 'V' } }),
    entry({ method: 'POST', path: '/projects', body: { id: 'p1', name: 'P' } }),
    entry({ method: 'POST', path: '/habits', body: { id: 'h1', name: 'H' } }),
  ]
  expect(applyQueue([], entries, '2026-10-31', false).habits.map((h) => h.id)).toEqual(['h1'])
  expect(applyTaskQueue([], entries).tasks.map((t) => t.id)).toEqual(['t1'])
  expect(applyProjectQueue([], entries).projects.map((p) => p.id)).toEqual(['p1'])
})

const project = (over: Partial<ApiProject> = {}): ApiProject => ({
  id: 'p', name: 'Tesis', description: null, status: 'active', color: '#9b7fc4', category: null,
  created_at: '2026-01-01T05:00:00Z', tasks_total: 3, tasks_pending: 1, ...over,
})

test('crear, editar y borrar un proyecto se ven sin esperar, sin predecir los conteos', () => {
  const created = applyProjectQueue([project()], [entry({ method: 'POST', path: '/projects', body: { id: 'n', name: 'Nuevo' } })])
  expect(created.projects.map((p) => p.id)).toEqual(['n', 'p'])
  expect(created.projects[0]).toMatchObject({ status: 'active', tasks_total: 0 })
  expect(created.pendingIds.has('n')).toBe(true)
  const edited = applyProjectQueue([project()], [entry({ method: 'PATCH', path: '/projects/p', body: { name: 'Otro' } })])
  expect(edited.projects[0]).toMatchObject({ name: 'Otro', tasks_total: 3 })
  expect(applyProjectQueue([project()], [entry({ method: 'DELETE', path: '/projects/p' })]).projects).toEqual([])
})
