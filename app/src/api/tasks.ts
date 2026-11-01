import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { v7 as uuidv7 } from 'uuid'
import type { ApiChecklistItem, ApiTask, TaskHistoryPage, TaskInput } from '../types'
import { get, type ApiRequest } from './client'
import { localDate } from './habits'
import { enqueue, useQueue, type QueueEntry } from './queryClient'

// ---------- Orden del tablero ----------

// En orden ASCII, el mismo con el que compara SQLite (`ORDER BY rank, id`).
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const MIDDLE = DIGITS[Math.floor(DIGITS.length / 2)]

/** Una clave en (a, b), con `b = null` como «sin techo». Exige a < b. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while (n < b.length && (a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const low = a ? DIGITS.indexOf(a[0]) : 0
  const high = b ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]
  if (b && b.length > 1) return b[0]
  return DIGITS[low] + midpoint(a.slice(1), null)
}

/** Agregar al final es lo común: avanza un dígito en vez de partir el resto a la mitad. */
function after(a: string): string {
  const i = [...a].findIndex((c) => c !== 'z')
  return i < 0 ? a + MIDDLE : a.slice(0, i) + DIGITS[DIGITS.indexOf(a[i]) + 1]
}

/**
 * La clave entre dos vecinas de una columna; `null` es el borde. Se calcula una vez, al soltar.
 *
 * Entre dos claves iguales (dos dispositivos sin conexión) o entre `x` y `x0` no cabe ninguna: la
 * tarjeta queda justo después de `a`, sin error. Las claves de aquí nunca terminan en `0`, así que
 * el segundo caso solo puede venir de datos migrados.
 */
export function rankBetween(a: string | null, b: string | null): string {
  if (a === null && b === null) return MIDDLE
  if (b === null) return after(a!)
  const low = a ?? ''
  return low < b ? midpoint(low, b) : low + MIDDLE
}

const byRank = (x: ApiTask, y: ApiTask) =>
  x.rank < y.rank ? -1 : x.rank > y.rank ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0

/** La clave para quedar de última en una columna. */
export function rankAtEnd(tasks: Pick<ApiTask, 'status' | 'rank'>[], status: ApiTask['status']): string {
  const ranks = tasks.filter((t) => t.status === status).map((t) => t.rank).sort()
  return rankBetween(ranks.at(-1) ?? null, null)
}

// ---------- Escrituras ----------

type Named = Pick<ApiTask, 'id' | 'title'>
type Placed = { status?: 'todo' | 'doing'; rank?: string }

// Los ids nacen aquí, una sola vez: reintentar la misma request no duplica (ADR 0004).
export const taskRequests = {
  create: (input: TaskInput, rank: string, status?: 'todo' | 'doing'): ApiRequest => ({
    method: 'POST',
    path: '/tasks',
    body: { id: uuidv7(), rank, ...input, ...(status && { status }) },
    label: `Crear ${input.title}`,
  }),
  update: (t: Named, patch: Partial<TaskInput>): ApiRequest => ({
    method: 'PATCH',
    path: `/tasks/${t.id}`,
    body: patch,
    label: `Editar ${t.title}`,
  }),
  remove: (t: Named): ApiRequest => ({
    method: 'DELETE',
    path: `/tasks/${t.id}`,
    label: `Borrar ${t.title}`,
  }),
  complete: (t: Named, rank?: string, now = new Date()): ApiRequest => {
    const local_date = localDate(now)
    return {
      method: 'POST',
      path: `/tasks/${t.id}/complete`,
      body: { id: uuidv7(), local_date, ...(rank && { rank }) },
      label: `Completar ${t.title} · ${local_date}`,
    }
  },
  /** `grant_id` sale de la vista con la cola encima: puede ser una concesión aún sin sincronizar. */
  uncomplete: (t: Named & Pick<ApiTask, 'grant_id'>, place: Placed = {}): ApiRequest => ({
    method: 'POST',
    path: `/tasks/${t.id}/uncomplete`,
    body: { grant_id: t.grant_id, ...place },
    label: `Descompletar ${t.title}`,
  }),
  /** Desde el historial: la lista no tiene la tarea, así que la request la lleva para la vista. */
  uncompleteOlder: (t: ApiTask): ApiRequest => ({ ...taskRequests.uncomplete(t), snapshot: t }),
  /** Soltar en una columna. Entrar o salir de `done` da XP o lo devuelve, así que no es un `PATCH`. */
  move: (t: Named & Pick<ApiTask, 'status' | 'grant_id'>, status: ApiTask['status'], rank: string, now = new Date()): ApiRequest => {
    if (status === 'done') {
      if (t.status !== 'done') return taskRequests.complete(t, rank, now)
    } else if (t.status === 'done') {
      return taskRequests.uncomplete(t, { status, rank })
    }
    return {
      method: 'PATCH',
      path: `/tasks/${t.id}`,
      body: t.status === status ? { rank } : { status, rank },
      label: `Mover ${t.title}`,
    }
  },
  addItem: (taskId: string, text: string): ApiRequest => ({
    method: 'POST',
    path: `/tasks/${taskId}/checklist`,
    body: { id: uuidv7(), text },
    label: `Agregar ${text}`,
  }),
  updateItem: (item: Pick<ApiChecklistItem, 'id' | 'text'>, patch: { text?: string; done?: boolean }): ApiRequest => ({
    method: 'PATCH',
    path: `/tasks/checklist/${item.id}`,
    body: patch,
    label: `Editar ${item.text}`,
  }),
  removeItem: (item: Pick<ApiChecklistItem, 'id' | 'text'>): ApiRequest => ({
    method: 'DELETE',
    path: `/tasks/checklist/${item.id}`,
    label: `Borrar ${item.text}`,
  }),
}

// ---------- La vista con la cola encima ----------

function withChecklist(t: ApiTask, checklist: ApiChecklistItem[]): ApiTask {
  return {
    ...t,
    checklist,
    checklist_total: checklist.length,
    checklist_done: checklist.filter((i) => i.done).length,
  }
}

/**
 * Las tareas con lo que aún no llega al servidor encima, en el orden del tablero. Derivada, como en
 * Hábitos: sobrevive a un refetch y a reiniciar, y no hay nada que revertir. El XP no se predice.
 * Cada caso hace lo que hará el servidor, también cuando la request allá no tendría efecto.
 */
export function applyTaskQueue(
  tasks: ApiTask[],
  entries: Pick<QueueEntry, 'request' | 'status'>[],
): { tasks: ApiTask[]; pendingIds: Set<string> } {
  let out = tasks
  const pendingIds = new Set<string>()
  const change = (id: string, fn: (t: ApiTask) => ApiTask) => {
    out = out.map((t) => (t.id === id ? fn(t) : t))
  }
  for (const { request: r, status } of entries) {
    if (status !== 'pending' && status !== 'success') continue
    const [, resource, id, action] = r.path.split('/')
    const body = r.body as Record<string, never> | undefined

    if (resource === 'projects') {
      // ON DELETE SET NULL
      if (r.method === 'DELETE') out = out.map((t) => (t.project_id === id ? { ...t, project_id: null } : t))
      continue
    }
    if (resource !== 'tasks') continue

    if (id === 'checklist') {
      const itemId = action
      const owner = out.find((t) => t.checklist.some((i) => i.id === itemId))
      if (!owner) continue
      if (status === 'pending') pendingIds.add(owner.id)
      change(owner.id, (t) => withChecklist(t, r.method === 'DELETE'
        ? t.checklist.filter((i) => i.id !== itemId)
        : t.checklist.map((i) => (i.id === itemId ? { ...i, ...(body as Partial<ApiChecklistItem>) } : i))))
      continue
    }

    const target = id ?? (body?.id as string | undefined)
    if (target && status === 'pending') pendingIds.add(target)

    if (r.method === 'POST' && !id) {
      if (out.some((t) => t.id === target)) continue
      out = [...out, {
        description: null,
        category: null,
        priority: 'medium',
        project_id: null,
        due_date: null,
        xp_reward: 15,
        status: 'todo',
        grant_id: null,
        completed: false,
        completed_at: null,
        completed_on: null,
        remind_at: null,
        tags: null,
        created_at: new Date().toISOString(),
        checklist: [],
        checklist_done: 0,
        checklist_total: 0,
        ...(body as unknown as TaskInput & Pick<ApiTask, 'id' | 'rank'>),
      }]
    } else if (r.method === 'PATCH') {
      change(id, (t) => {
        const patch = { ...(body as Partial<ApiTask>) }
        // el servidor rechaza cambiar de estado una tarea hecha
        if (t.status === 'done') delete patch.status
        return { ...t, ...patch }
      })
    } else if (r.method === 'DELETE') {
      out = out.filter((t) => t.id !== id)
    } else if (action === 'complete') {
      const c = body as unknown as { id: string; local_date: string; rank?: string }
      change(id, (t) => t.status === 'done' ? t : {
        ...t,
        status: 'done',
        completed: true,
        grant_id: c.id,
        completed_on: c.local_date,
        completed_at: new Date().toISOString(),
        rank: c.rank ?? t.rank,
      })
    } else if (action === 'uncomplete') {
      const u = body as unknown as { grant_id: string | null; status?: 'todo' | 'doing'; rank?: string }
      if (r.snapshot && !out.some((t) => t.id === id)) out = [...out, r.snapshot as ApiTask]
      change(id, (t) => t.status !== 'done' || t.grant_id !== u.grant_id ? t : {
        ...t,
        status: u.status ?? 'todo',
        completed: false,
        grant_id: null,
        completed_on: null,
        completed_at: null,
        rank: u.rank ?? t.rank,
      })
    } else if (action === 'checklist') {
      const i = body as unknown as { id: string; text: string }
      change(id, (t) => {
        if (t.checklist.some((x) => x.id === i.id)) return t
        const position = Math.max(-1, ...t.checklist.map((x) => x.position)) + 1
        return withChecklist(t, [...t.checklist, { id: i.id, task_id: id, text: i.text, done: false, position }])
      })
    }
  }
  return { tasks: [...out].sort(byRank), pendingIds }
}

/** Los cambios de la cola en los conteos de cada proyecto, frente a lo que ya contó el servidor. */
export function projectCountDeltas(
  tasks: ApiTask[],
  entries: Pick<QueueEntry, 'request' | 'status'>[],
): Map<string, { total: number; pending: number }> {
  const deltas = new Map<string, { total: number; pending: number }>()
  const add = (list: ApiTask[], sign: number) => {
    for (const t of list) {
      if (!t.project_id) continue
      const d = deltas.get(t.project_id) ?? { total: 0, pending: 0 }
      d.total += sign
      if (t.status !== 'done') d.pending += sign
      deltas.set(t.project_id, d)
    }
  }
  // lo traído del historial ya estaba contado, como hecha
  const known = new Set(tasks.map((t) => t.id))
  const older = entries
    .filter((e) => e.status !== 'error' && e.request.snapshot)
    .map((e) => e.request.snapshot as ApiTask)
    .filter((t) => !known.has(t.id) && (known.add(t.id), true))
  add([...tasks, ...older], -1)
  add(applyTaskQueue(tasks, entries).tasks, 1)
  return deltas
}

const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** Los criterios de la v1: por prioridad y luego fecha, o por fecha con lo que no tiene al final. */
export function sortTasks(tasks: ApiTask[], sort: 'priority' | 'due_date'): ApiTask[] {
  const due = (t: ApiTask) => t.due_date ?? '9999-12-31'
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return [...tasks].sort((a, b) => sort === 'due_date'
    ? text(due(a), due(b))
    : (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1) || text(due(a), due(b)))
}

/** Las vecinas para subir o bajar un puesto en la columna. `null`: ya está en el borde. */
export function stepNeighbours(column: Pick<ApiTask, 'id' | 'rank'>[], id: string, step: -1 | 1): [string | null, string | null] | null {
  const i = column.findIndex((t) => t.id === id)
  const j = i + step
  if (i < 0 || j < 0 || j >= column.length) return null
  const rest = column.filter((t) => t.id !== id)
  return [rest[j - 1]?.rank ?? null, rest[j]?.rank ?? null]
}

/** `datetime-local` (hora del dispositivo) → instante UTC, sin milisegundos (invariante 3). */
export const remindAtToUtc = (local: string) =>
  local ? new Date(local).toISOString().replace(/\.\d+Z$/, 'Z') : null

/** Instante UTC → valor de `datetime-local`. */
export function remindAtToLocal(utc: string | null): string {
  if (!utc) return ''
  const d = new Date(utc)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------- Lecturas ----------

export function useTasks() {
  const query = useQuery({ queryKey: ['tasks', 'list'], queryFn: () => get<ApiTask[]>('/tasks') })
  const queue = useQueue()
  return { query, queue, ...applyTaskQueue(query.data ?? [], queue) }
}

/** Las completadas que la lista ya no trae (fila 23). Lo descompletado pasa a la lista al instante. */
export function useTaskHistory(enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ['tasks', 'history'],
    queryFn: ({ pageParam }) =>
      get<TaskHistoryPage>(`/tasks/history${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled,
  })
  const queue = useQueue()
  const older = query.data?.pages.flatMap((p) => p.tasks) ?? []
  const ids = new Set(older.map((t) => t.id))
  const tasks = applyTaskQueue(older, queue).tasks.filter((t) => ids.has(t.id) && t.status === 'done')
  return { query, tasks }
}

export const taskActions = {
  create: (input: TaskInput, rank: string, status?: 'todo' | 'doing') => enqueue(taskRequests.create(input, rank, status)),
  update: (t: Named, patch: Partial<TaskInput>) => enqueue(taskRequests.update(t, patch)),
  remove: (t: Named) => enqueue(taskRequests.remove(t)),
  complete: (t: Named) => enqueue(taskRequests.complete(t)),
  uncomplete: (t: Named & Pick<ApiTask, 'grant_id'>) => enqueue(taskRequests.uncomplete(t)),
  uncompleteOlder: (t: ApiTask) => enqueue(taskRequests.uncompleteOlder(t)),
  /** `prev` y `next` son las claves vecinas en la columna de destino; `null`, el borde. */
  move: (t: Named & Pick<ApiTask, 'status' | 'grant_id'>, status: ApiTask['status'], prev: string | null, next: string | null) =>
    enqueue(taskRequests.move(t, status, rankBetween(prev, next))),
  addItem: (taskId: string, text: string) => enqueue(taskRequests.addItem(taskId, text)),
  updateItem: (item: Pick<ApiChecklistItem, 'id' | 'text'>, patch: { text?: string; done?: boolean }) =>
    enqueue(taskRequests.updateItem(item, patch)),
  removeItem: (item: Pick<ApiChecklistItem, 'id' | 'text'>) => enqueue(taskRequests.removeItem(item)),
}
