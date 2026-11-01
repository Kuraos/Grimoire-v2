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
const applyOnline = () => onlineManager.setOnline(connected && authorized)
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

const PERSISTED_QUERIES = ['habits/list', 'habits/heatmap', 'user', 'habit-categories', 'tasks/list', 'projects']

function serializeCache(): string {
  const state = dehydrate(queryClient, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (q) =>
      q.state.status === 'success' && PERSISTED_QUERIES.some((k) => q.queryKey.join('/').startsWith(k)),
  })
  return JSON.stringify(state.queries)
}

/** Un solo escritor por clave: la última versión gana aunque Preferences tarde. */
function writer(key: string, read: () => string) {
  let running = false
  let dirty = false
  return async () => {
    dirty = true
    if (running) return
    running = true
    try {
      while (dirty) {
        dirty = false
        await Preferences.set({ key, value: read() })
      }
    } catch (e) {
      console.error('No se pudo guardar', key, e)
    } finally {
      running = false
    }
  }
}

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
    const writeQueue = writer(QUEUE_KEY, serializeQueue)
    queryClient.getMutationCache().subscribe((e) => {
      if (e.type === 'added' || e.type === 'removed' || e.type === 'updated') void writeQueue()
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
