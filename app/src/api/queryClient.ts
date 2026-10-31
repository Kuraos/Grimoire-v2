import { MutationCache, QueryCache, QueryClient, useMutation } from '@tanstack/react-query'
import { ApiError, send, type ApiRequest } from './client'

const errorListeners = new Set<(message: string) => void>()

/** Todo error de la API pasa por aquí; `AppProvider` lo convierte en toast. */
export function onApiError(fn: (message: string) => void): () => void {
  errorListeners.add(fn)
  return () => errorListeners.delete(fn)
}

const report = (e: Error) => errorListeners.forEach((fn) => fn(e.message))

/** Sin respuesta o error del servidor. Un 4xx no cambia por reintentarlo. */
const retryable = (failures: number, e: Error) =>
  failures < 2 && e instanceof ApiError && (e.status === 0 || e.status >= 500)

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: report }),
  mutationCache: new MutationCache({ onError: report }),
  defaultOptions: { queries: { staleTime: 30_000, retry: retryable } },
})

const API_MUTATION = ['api']

// Por clave y no en cada hook: una mutación restaurada de disco no tiene hook que le
// diga qué hacer. `scope` las ejecuta en orden. Ver ADR 0008.
queryClient.setMutationDefaults(API_MUTATION, {
  mutationFn: (r) => send(r as unknown as ApiRequest),
  scope: { id: 'api' },
  retry: retryable,
  // ponytail: refresca todo lo que esté en pantalla; afinar si la cuota de requests pesa
  onSettled: () => queryClient.invalidateQueries(),
})

/** Manda una escritura. `pending` sigue activo hasta que termina el refresco. */
export function useSend() {
  const m = useMutation<unknown, Error, ApiRequest>({ mutationKey: API_MUTATION })
  return { send: <T>(r: ApiRequest) => m.mutateAsync(r) as Promise<T>, pending: m.isPending }
}
