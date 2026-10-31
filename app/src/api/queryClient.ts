import { MutationCache, QueryCache, QueryClient, useMutationState, type Mutation } from '@tanstack/react-query'
import { ApiError, send, type ApiRequest } from './client'

const errorListeners = new Set<(message: string) => void>()

/** Todo error de la API pasa por aquí; `AppProvider` lo convierte en toast. */
export function onApiError(fn: (message: string) => void): () => void {
  errorListeners.add(fn)
  return () => errorListeners.delete(fn)
}

const report = (message: string) => errorListeners.forEach((fn) => fn(message))

/** Sin respuesta, servidor caído o «más tarde»: no dice nada de la request en sí. */
const isTransient = (e: Error) =>
  e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 408 || e.status === 429)

export const API_MUTATION = ['api']
/** Lo que no pasa por la cola: repetirlo no es idempotente (categorías, ADR 0008). */
export const DIRECT_MUTATION = ['api-direct']

const isQueued = (m: Mutation<any, any, any, any>) => m.options.mutationKey?.[0] === API_MUTATION[0] // eslint-disable-line @typescript-eslint/no-explicit-any

/** El resultado de una escritura de la cola. La restaurada de disco no tiene promesa. */
export type SyncResult = { request: ApiRequest; data: unknown; ageMs: number }

let results: SyncResult[] = []
let resultsListener: ((r: SyncResult[]) => void) | null = null

function flushResults() {
  if (!resultsListener || results.length === 0) return
  const batch = results
  results = []
  resultsListener(batch)
}

/** Un lote por vaciado de la cola. Lo que terminó antes de suscribirse se entrega al suscribirse. */
export function onSyncResults(fn: (r: SyncResult[]) => void): () => void {
  resultsListener = fn
  flushResults()
  return () => {
    resultsListener = null
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (e) => report(e.message) }),
  mutationCache: new MutationCache({
    // aquí y no en los defaults: es el único punto que recibe la mutación (y su edad)
    onSuccess: (data, variables, _context, mutation) => {
      if (!isQueued(mutation)) return
      const ageMs = Date.now() - mutation.state.submittedAt
      results.push({ request: variables as ApiRequest, data, ageMs })
    },
    onError: (e, variables) => {
      const label = (variables as ApiRequest | undefined)?.label
      report(label ? `${label}: ${e.message}` : e.message)
    },
  }),
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => n < 2 && isTransient(e) },
  },
})

const queuedPending = () =>
  queryClient.getMutationCache().getAll().filter((m) => isQueued(m) && m.state.status === 'pending')

/** Tras `onSettled`, TanStack marca el `success`: por eso se limpia en el siguiente turno. */
const forgetSucceeded = () =>
  setTimeout(() => {
    const cache = queryClient.getMutationCache()
    cache.getAll().filter((m) => isQueued(m) && m.state.status === 'success').forEach((m) => cache.remove(m))
  }, 0)

const SERVER_WARNING_AFTER = 8

// Por clave y no en cada hook: una mutación restaurada de disco no tiene hook que le
// diga qué hacer. `scope` las ejecuta en orden. Ver ADR 0008.
queryClient.setMutationDefaults(API_MUTATION, {
  mutationFn: (r) => send(r as unknown as ApiRequest),
  scope: { id: 'api' },
  // se borra a mano: las rechazadas esperan a que las descarten y las exitosas al refresco
  gcTime: Infinity,
  // Un 401 también «reintenta»: sin token `onlineManager` está apagado y el retryer se pausa
  // hasta que haya uno. Bloquear la cola con un 5xx eterno es a propósito: perder datos es peor.
  retry: (failures, e) => {
    if (failures === SERVER_WARNING_AFTER && e instanceof ApiError && e.status > 0) {
      report('El servidor sigue fallando; tus cambios siguen guardados')
    }
    return isTransient(e) || (e instanceof ApiError && e.status === 401)
  },
  retryDelay: (failures) => Math.min(1000 * 2 ** failures, 60_000),
  // Sigue `pending` durante este callback, así que 1 significa que era la última. La vista
  // deriva de la cola: las exitosas se superponen hasta que el refresco las traiga.
  onSettled: async () => {
    if (queuedPending().length > 1) return
    flushResults()
    await queryClient.invalidateQueries()
    forgetSucceeded()
  },
})

queryClient.setMutationDefaults(DIRECT_MUTATION, {
  mutationFn: (r) => send(r as unknown as ApiRequest),
  // sin conexión falla al instante y se avisa, en vez de pausarse sin que nadie lo vea
  networkMode: 'always',
  onSettled: () => queryClient.invalidateQueries(),
})

/** Encola una escritura. No se espera: el resultado llega por `onSyncResults` o `onApiError`. */
export function enqueue(request: ApiRequest): void {
  queryClient
    .getMutationCache()
    .build(queryClient, { mutationKey: API_MUTATION })
    .execute(request)
    .catch(() => {})
}

export type QueueEntry = {
  id: number
  request: ApiRequest
  status: 'pending' | 'success' | 'error' | 'idle'
  message: string | undefined
}

/** La cola tal como está: lo pendiente, lo recién sincronizado y lo rechazado. */
export const useQueue = (): QueueEntry[] =>
  useMutationState({
    filters: { mutationKey: API_MUTATION },
    select: (m): QueueEntry => ({
      id: m.mutationId,
      request: m.state.variables as ApiRequest,
      status: m.state.status,
      message: (m.state.error as Error | null)?.message,
    }),
  }).filter((e) => e.request)

/** Descarta un rechazo ya leído. */
export function dismissQueueEntry(id: number): void {
  const cache = queryClient.getMutationCache()
  const m = cache.getAll().find((x) => x.mutationId === id)
  if (m) cache.remove(m)
}
