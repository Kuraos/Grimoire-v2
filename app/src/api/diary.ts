import { App as CapApp } from '@capacitor/app'
import { Preferences } from '@capacitor/preferences'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { v7 as uuidv7 } from 'uuid'
import type { DiaryConflict, DiaryDay, DiaryEntry, DiarySearchHit, DiaryVolume } from '../types'
import { get, type ApiRequest } from './client'
import { enqueue, queryClient, useQueue, type QueueEntry } from './queryClient'
import { saveQueueNow } from './sync'

/*
 * Diario en el cliente (docs/tasks/fase-2-diario.md, decisiones 1, 2 y 3). Ningún texto escrito se
 * pierde:
 *   1. Cada tecla va a un borrador en disco (`DRAFTS_KEY`, por día, con 1 s de espera).
 *   2. Se encola un `PUT` con el texto completo a los 30 s sin teclear, al salir del campo, al
 *      cambiar de día y al pasar la app a segundo plano.
 *   3. Cuando la cola ya está en disco, el borrador se borra.
 * Al arrancar, lo que siga en borradores se encola. Cada `PUT` lleva `save_id` nuevo y como base el
 * del guardado anterior de este dispositivo, así que escribir sin señal nunca da conflicto consigo
 * mismo. Si el servidor tenía un texto que este dispositivo no vio, lo guarda aparte (decisión 1).
 */

const DRAFTS_KEY = 'grimoire-diary-drafts-v1'
const DRAFT_DELAY_MS = 1000
/** El de la v1 (`useAutoSave`). */
export const IDLE_SAVE_MS = 30_000
const DIARY = '/diary/'

/** Etiquetas `undefined`: no se tocaron, y el `PUT` las omite para que el servidor las conserve. */
export type DiaryText = { content: string; tags?: string | null }

type SaveBody = {
  id: string
  save_id: string
  base_save_id: string | null
  content: string
  tags?: string | null
}

export const diaryRequests = {
  save: (day: string, entryId: string, baseSaveId: string | null, text: DiaryText): ApiRequest => ({
    method: 'PUT',
    path: `${DIARY}${day}`,
    body: {
      id: entryId,
      save_id: uuidv7(),
      base_save_id: baseSaveId,
      content: text.content,
      ...(text.tags === undefined ? {} : { tags: text.tags }),
    } satisfies SaveBody,
    label: `Diario del ${day}`,
  }),
  /** Repetirlo da 204: cumple el contrato de la cola. */
  discardConflict: (id: string): ApiRequest => ({
    method: 'DELETE',
    path: `${DIARY}conflicts/${id}`,
    label: 'Descartar la otra versión',
  }),
}

const saveOf = (r: ApiRequest, day: string): SaveBody | null =>
  r.method === 'PUT' && r.path === `${DIARY}${day}` ? (r.body as SaveBody) : null

const discardedId = (r: ApiRequest): string | null =>
  r.method === 'DELETE' && r.path.startsWith(`${DIARY}conflicts/`) ? r.path.slice(`${DIARY}conflicts/`.length) : null

const emptyEntry = (day: string): DiaryEntry =>
  ({ id: null, local_date: day, content: '', tags: null, save_id: null, updated_at: null })

type Entries = Pick<QueueEntry, 'request' | 'status'>[]

/**
 * El día con lo que aún no llega al servidor encima: el último guardado en cola manda en texto,
 * etiquetas, id y `save_id` (la base del siguiente). Uno rechazado nunca se aplicó: no cuenta. Las
 * copias con un descarte en cola ya no se muestran.
 */
export function applyDiaryQueue(server: DiaryDay | undefined, entries: Entries, day: string) {
  let entry = server?.entry ?? emptyEntry(day)
  let pending = false
  const discarded = new Set<string>()
  for (const { request, status } of entries) {
    if (status !== 'pending' && status !== 'success') continue
    const id = discardedId(request)
    if (id) discarded.add(id)
    const b = saveOf(request, day)
    if (!b) continue
    pending ||= status === 'pending'
    entry = {
      ...entry,
      id: entry.id ?? b.id,
      content: b.content,
      tags: b.tags === undefined ? entry.tags : b.tags,
      save_id: b.save_id,
    }
  }
  const conflicts: DiaryConflict[] = (server?.conflicts ?? []).filter((c) => !discarded.has(c.id))
  return { entry, conflicts, summary: server?.summary ?? null, pending }
}

/** El texto difiere de lo que ya está guardado o en cola. */
export const isDirty = (text: DiaryText, entry: DiaryEntry) =>
  text.content !== entry.content || (text.tags !== undefined && text.tags !== entry.tags)

// ---------- Borradores en disco ----------

let drafts: Record<string, DiaryText> = {}
let loaded: Promise<void> | null = null
let chain: Promise<unknown> = Promise.resolve()
let draftTimer: ReturnType<typeof setTimeout> | undefined

/** Una sola fila de escrituras: un borrado nunca adelanta a una escritura anterior. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn)
  chain = run.catch(() => {})
  return run
}

const writeDrafts = () =>
  serial(() => Preferences.set({ key: DRAFTS_KEY, value: JSON.stringify(drafts) }))

function loadDrafts(): Promise<void> {
  loaded ??= (async () => {
    const { value } = await Preferences.get({ key: DRAFTS_KEY })
    try {
      const parsed = JSON.parse(value ?? '{}')
      drafts = parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      drafts = {} // JSON a medio escribir
    }
  })()
  return loaded
}

export const draftFor = (day: string): DiaryText | undefined => drafts[day]

/** Anota el texto del día y lo escribe en disco tras 1 s sin cambios. */
export function setDraft(day: string, text: DiaryText): void {
  drafts = { ...drafts, [day]: text }
  clearTimeout(draftTimer)
  draftTimer = setTimeout(() => void writeDrafts(), DRAFT_DELAY_MS)
}

/** Lo que el dispositivo cree de un día: lo leído del servidor (o de la caché) con la cola encima. */
function currentView(day: string) {
  const entries = queryClient.getMutationCache().getAll().map((m) => ({
    request: m.state.variables as ApiRequest,
    status: m.state.status,
  })).filter((e) => e.request)
  return applyDiaryQueue(queryClient.getQueryData<DiaryDay>(['diary', 'day', day]), entries, day)
}

/**
 * Encola el texto del día si difiere de lo guardado y devuelve la base del siguiente guardado. `base`
 * es la versión sobre la que se escribió; sin ella, la que el dispositivo cree actual. El editor pasa
 * la suya: si el servidor cambió debajo, el otro texto queda como copia y no se pisa (decisión 1).
 */
export function queueDiary(day: string, text: DiaryText, base?: string | null): string | null {
  const { entry } = currentView(day)
  const from = base === undefined ? entry.save_id : base
  if (!isDirty(text, entry)) return from
  const request = diaryRequests.save(day, entry.id ?? uuidv7(), from, text)
  enqueue(request)
  return (request.body as SaveBody).save_id
}

/** Espera a que la cola esté en disco y borra el borrador, salvo que haya cambiado mientras tanto. */
export async function settleDraft(day: string, text: DiaryText): Promise<void> {
  await saveQueueNow()
  if (drafts[day] && drafts[day].content === text.content && drafts[day].tags === text.tags) {
    const { [day]: _, ...rest } = drafts // eslint-disable-line @typescript-eslint/no-unused-vars
    drafts = rest
    clearTimeout(draftTimer)
    await writeDrafts()
  }
}

export async function commitDiary(day: string, text: DiaryText, base?: string | null): Promise<void> {
  queueDiary(day, text, base)
  await settleDraft(day, text)
}

/**
 * Arranque, después de `bootSync` (que restaura la cola y la caché): encola los borradores que
 * quedaron de una app cerrada antes de guardar. La base sale de la caché de 7 días; sin ella va
 * `null`, y si el servidor tenía otro texto lo guarda aparte.
 */
export async function bootDiary(): Promise<void> {
  try {
    await loadDrafts()
    for (const [day, text] of Object.entries(drafts)) await commitDiary(day, text)
  } catch (e) {
    console.error('No se pudieron recuperar los borradores del diario', e)
  }
}

// ---------- Lecturas ----------

export const dayKey = (day: string) => ['diary', 'day', day]

export function useDiaryDay(day: string) {
  const query = useQuery({ queryKey: dayKey(day), queryFn: () => get<DiaryDay>(`${DIARY}${day}`) })
  const queue = useQueue()
  return { query, ...applyDiaryQueue(query.data, queue, day) }
}

/**
 * Los días escritos de los últimos 12 meses con lo que está en cola encima: una entrada nueva sale
 * en el volumen y en el minicalendario antes de sincronizar.
 */
export function applyVolumeQueue(volume: DiaryVolume | undefined, entries: Entries): DiaryVolume {
  const points = new Map((volume?.points ?? []).map((p) => [p.local_date, p.length]))
  for (const { request, status } of entries) {
    if (status !== 'pending' && status !== 'success' || request.method !== 'PUT' || !request.path.startsWith(DIARY)) continue
    const day = request.path.slice(DIARY.length)
    const { content } = request.body as SaveBody
    // como `diary::is_written`: texto tras quitar espacios
    if (content.trim()) points.set(day, [...content].length)
    else points.delete(day)
  }
  const added = [...points.keys()].filter((d) => !volume?.points.some((p) => p.local_date === d)).length
  const removed = (volume?.points ?? []).filter((p) => !points.has(p.local_date)).length
  return {
    points: [...points].sort(([a], [b]) => (a < b ? -1 : 1)).map(([local_date, length]) => ({ local_date, length })),
    total: (volume?.total ?? 0) + added - removed,
  }
}

export function useDiaryVolume() {
  const query = useQuery({ queryKey: ['diary', 'volume'], queryFn: () => get<DiaryVolume>(`${DIARY}volume`) })
  return { query, ...applyVolumeQueue(query.data, useQueue()) }
}

/** Sin conexión no busca: `fetchStatus` queda en `paused` y la vista lo dice. */
export function useDiarySearch(q: string) {
  return useQuery({
    queryKey: ['diary', 'search', q],
    queryFn: () => get<DiarySearchHit[]>(`${DIARY}search?q=${encodeURIComponent(q)}`),
    enabled: q.trim() !== '',
  })
}

// ---------- Editor ----------

export type DiaryStatus = 'loading' | 'editing' | 'queued' | 'saved'

/**
 * El texto del día en edición. Se carga del borrador o de lo guardado, y desde ahí manda lo que se
 * teclea: un refresco no pisa cambios sin guardar. Sin cambios pendientes, una versión más nueva del
 * servidor sí se carga: al abrir con señal, la caché de disco puede ser de antes del último guardado
 * (2.4.6). Sin conexión ni caché, arranca vacío.
 */
export function useDiaryEditor(day: string) {
  const view = useDiaryDay(day)
  const { query } = view
  const ready = query.data !== undefined || query.isError || query.fetchStatus === 'paused'
  const [text, setText] = useState<(DiaryText & { day: string }) | null>(null)
  const current = text?.day === day ? text : null

  // Lo último tecleado, para guardarlo desde temporizadores y oyentes. Se asigna al cargar y al
  // teclear, no en el render: al cambiar de día, el render nuevo ya no tiene el texto del anterior,
  // y la limpieza que lo guarda corre después.
  const latest = useRef<(DiaryText & { day: string }) | null>(null)
  // la versión sobre la que se escribe, y si hay cambios sin encolar
  const base = useRef<string | null>(null)
  const edited = useRef(false)

  useEffect(() => {
    if (!ready) return
    if (current && (edited.current || view.entry.save_id === base.current)) return
    const draft = draftFor(day)
    const loaded = { day, content: draft?.content ?? view.entry.content, tags: draft?.tags }
    latest.current = loaded
    base.current = view.entry.save_id
    edited.current = draft !== undefined
    setText(loaded)
  }, [ready, current, day, view.entry.content, view.entry.save_id])

  const commit = useCallback(() => {
    const t = latest.current
    if (!t) return Promise.resolve()
    const text = { content: t.content, tags: t.tags }
    base.current = queueDiary(t.day, text, base.current)
    edited.current = false
    return settleDraft(t.day, text)
  }, [])

  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const update = useCallback((next: Partial<DiaryText>) => {
    const t = latest.current
    if (!t) return
    const merged = { ...t, ...next }
    latest.current = merged
    edited.current = true
    setText(merged)
    setDraft(t.day, { content: merged.content, tags: merged.tags })
    clearTimeout(idle.current)
    idle.current = setTimeout(() => void commit(), IDLE_SAVE_MS)
  }, [commit])

  // cambiar de día o salir de la vista guarda lo del día que se deja
  useEffect(() => () => {
    clearTimeout(idle.current)
    void commit()
  }, [day, commit])

  // segundo plano: en Android el sistema puede matar la app ahí (decisión 2)
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') void commit() }
    document.addEventListener('visibilitychange', hidden)
    const handle = CapApp.addListener('pause', () => void commit())
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      void handle.then((h) => h.remove())
    }
  }, [commit])

  const status: DiaryStatus = !current ? 'loading'
    : isDirty(current, view.entry) ? 'editing'
      : view.pending ? 'queued'
        : 'saved'

  return {
    ready: current !== null,
    content: current?.content ?? '',
    tags: current?.tags === undefined ? view.entry.tags : current.tags,
    status,
    entry: view.entry,
    conflicts: view.conflicts,
    summary: view.summary,
    setContent: (content: string) => update({ content }),
    /** Las etiquetas se guardan al cambiar, como en la v1. */
    setTags: (tags: string) => {
      update({ tags })
      void commit()
    },
    commit,
    discardConflict: (id: string) => enqueue(diaryRequests.discardConflict(id)),
  }
}
