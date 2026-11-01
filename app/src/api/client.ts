import { SecureStorage } from '@aparajita/capacitor-secure-storage'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'https://grimoire.jbustosbriceno.workers.dev'

const TOKEN_KEY = 'grimoire-token'

// el token vive en el Keystore de Android, no en localStorage
let token: string | null = null
const unauthorizedListeners = new Set<() => void>()

export async function loadToken(): Promise<string | null> {
  const stored = await SecureStorage.get(TOKEN_KEY)
  token = typeof stored === 'string' && stored ? stored : null
  return token
}

export async function saveToken(value: string): Promise<void> {
  await SecureStorage.set(TOKEN_KEY, value)
  token = value
}

/** Avisa cuando el servidor rechaza el token: hay que volver a pedirlo. */
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}

export class ApiError extends Error {
  /** 0 = no hubo respuesta. */
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor')
  }
  const data = await res.json().catch(() => null)
  if (res.status === 401) {
    token = null
    await SecureStorage.remove(TOKEN_KEY)
    unauthorizedListeners.forEach((fn) => fn())
  }
  if (!res.ok) throw new ApiError(res.status, data?.detail ?? `HTTP ${res.status}`)
  return data as T
}

export const get = <T>(path: string) => call<T>('GET', path)

/**
 * Una escritura como dato: método, ruta y cuerpo, con los ids del cliente ya
 * adentro (ADR 0008). Es JSON puro, así que se puede guardar y reintentar.
 */
export type ApiRequest = {
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  /** Lo que se le muestra a Johan si el servidor la rechaza al sincronizar. */
  label?: string
  /**
   * La tarea tal como se veía al actuar. No viaja: es para que la vista derivada pueda mostrar
   * una tarea del historial que la lista todavía no trae, también tras reiniciar sin señal.
   */
  snapshot?: unknown
}

export const send = <T>(r: ApiRequest) => call<T>(r.method, r.path, r.body)
