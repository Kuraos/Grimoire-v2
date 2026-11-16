import { Network } from '@capacitor/network'
import { Preferences } from '@capacitor/preferences'
import { dehydrate, hydrate, onlineManager, type DehydratedState } from '@tanstack/react-query'
import { API_MUTATION, queryClient } from './queryClient'

const QUEUE_KEY = 'grimoire-queue-v1'
const CACHE_KEY = 'grimoire-cache-v1'
const CACHE_WRITE_DELAY_MS = 2000

// ---------- Conexión ----------

// «En línea» es tener red y token: sin cualquiera de los dos la cola espera. Reemplaza los
// eventos del navegador; arranca apagado para que el primer encendido reanude lo restaurado.
let connected = false
let authorized = false

/** Red y token por separado: el aviso global dice cuál falta (fase-2-transversal.md, decisión B). */
export type Link = { connected: boolean; authorized: boolean }
let link: Link = { connected, authorized }
const linkListeners = new Set<() => void>()
/** Para `useSyncExternalStore`: el mismo objeto mientras nada cambie. */
export const getLink = (): Link => link
export function subscribeLink(fn: () => void): () => void {
  linkListeners.add(fn)
  return () => linkListeners.delete(fn)
}

const applyOnline = () => {
  onlineManager.setOnline(connected && authorized)
  if (link.connected !== connected || link.authorized !== authorized) {
    link = { connected, authorized }
    linkListeners.forEach((fn) => fn())
  }
}
onlineManager.setEventListener(() => () => {})
onlineManager.setOnline(false)

export function setAuthorized(value: boolean): void {
  authorized = value
  applyOnline()
}

// ---------- Persistencia ----------

const QUEUED_STATUSES = ['pending', 'error']

/** La cola en JSON. Va todo lo `pending`, también lo que iba en vuelo: repetirlo es idempotente. */
export function serializeQueue(): string {
  const state = dehydrate(queryClient, {
    shouldDehydrateQuery: () => false,
    shouldDehydrateMutation: (m) =>
      m.options.mutationKey?.[0] === API_MUTATION[0] && QUEUED_STATUSES.includes(m.state.status),
  })
  return JSON.stringify(
    state.mutations.map((m) => {
      const error = m.state.error as Error | null
      return {
        ...m,
        state: {
          ...m.state,
          // `resumePausedMutations` solo reanuda lo pausado
          isPaused: m.state.status === 'pending',
          failureReason: null,
          // JSON.stringify de un Error pierde `message`
          error: error && { message: error.message },
        },
      }
    }),
  )
}

const PERSISTED_QUERIES = ['habits/list', 'habits/heatmap', 'user', 'habit-categories', 'tasks/list', 'projects', 'pomodoro/today', 'diary/volume']
/** Días de diario abiertos que se guardan para leer y escribir sin señal (fase-2-diario.md, decisión 3). */
const DIARY_DAYS = 7
const DAY_MS = 86_400_000

const bogotaDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ms)

/**
 * ¿Va a disco esta lectura? Del diario, solo los días de los últimos 7 (hoy incluido) que se
 * abrieron: el texto queda en el teléfono, sin salir a Google Drive (`allowBackup="false"`).
 */
export function persistedQuery(key: readonly unknown[], now: number): boolean {
  if (key[0] === 'diary' && key[1] === 'day') {
    const day = String(key[2])
    return day >= bogotaDate(now - (DIARY_DAYS - 1) * DAY_MS) && day <= bogotaDate(now)
  }
  return PERSISTED_QUERIES.some((k) => key.join('/').startsWith(k))
}

function serializeCache(): string {
  const now = Date.now()
  const state = dehydrate(queryClient, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (q) => q.state.status === 'success' && persistedQuery(q.queryKey, now),
  })
  return JSON.stringify(state.queries)
}

/**
 * Un solo escritor por clave: la última versión gana aunque Preferences tarde. La promesa termina
 * cuando lo pedido hasta ese momento ya está en disco, también si otra llamada iba en curso.
 */
function writer(key: string, read: () => string) {
  let running: Promise<void> | null = null
  let dirty = false
  return (): Promise<void> => {
    dirty = true
    running ??= (async () => {
      try {
        while (dirty) {
          dirty = false
          await Preferences.set({ key, value: read() })
        }
      } catch (e) {
        console.error('No se pudo guardar', key, e)
      } finally {
        running = null
      }
    })()
    return running
  }
}

let writeQueue: (() => Promise<void>) | null = null

/** Espera a que la cola, tal como está ahora, quede en disco. Antes de `bootSync`, no hace nada. */
export const saveQueueNow = (): Promise<void> => writeQueue?.() ?? Promise.resolve()

async function restore() {
  const [queue, cache] = await Promise.all([
    Preferences.get({ key: QUEUE_KEY }),
    Preferences.get({ key: CACHE_KEY }),
  ])
  const state: DehydratedState = {
    mutations: JSON.parse(queue.value ?? '[]'),
    queries: JSON.parse(cache.value ?? '[]'),
  }
  hydrate(queryClient, state)
  // Lo de disco se muestra ya, pero vencido: otro dispositivo pudo escribir, y con el `staleTime`
  // de 30 s una recarga recién guardada no le preguntaba al servidor. Sin red, se sigue viendo.
  await queryClient.invalidateQueries({ refetchType: 'none' })
}

let booted: Promise<void> | null = null

/** Restaura de disco, empieza a guardar y sigue la red. Una sola vez, antes de encender. */
export function bootSync(): Promise<void> {
  booted ??= (async () => {
    try {
      await restore()
    } catch (e) {
      // datos ilegibles: se sigue sin ellos para no dejar la app sin abrir
      console.error('No se pudo restaurar la cola', e)
    }
    const write = writer(QUEUE_KEY, serializeQueue)
    writeQueue = write
    queryClient.getMutationCache().subscribe((e) => {
      if (e.type === 'added' || e.type === 'removed' || e.type === 'updated') void write()
    })
    const writeCache = writer(CACHE_KEY, serializeCache)
    let cacheTimer: ReturnType<typeof setTimeout> | undefined
    queryClient.getQueryCache().subscribe(() => {
      clearTimeout(cacheTimer)
      cacheTimer = setTimeout(() => void writeCache(), CACHE_WRITE_DELAY_MS)
    })
    await Network.addListener('networkStatusChange', (s) => {
      connected = s.connected
      applyOnline()
    })
    connected = (await Network.getStatus()).connected
    applyOnline()
  })()
  return booted
}
