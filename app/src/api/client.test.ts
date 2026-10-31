import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { API_URL, get, loadToken, onUnauthorized, send } from './client'

const storage = vi.hoisted(() => ({
  get: vi.fn(async () => 'tok' as string | null),
  set: vi.fn(async () => {}),
  remove: vi.fn(async () => true),
}))
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: storage }))

beforeEach(async () => {
  storage.remove.mockClear()
  await loadToken()
})
afterEach(() => vi.unstubAllGlobals())

function stubFetch(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

test('manda el token y el cuerpo', async () => {
  const fetch = stubFetch(200, { xp_earned: 20 })
  await send({ method: 'POST', path: '/habits/h1/complete', body: { id: 'm1' } })
  expect(fetch).toHaveBeenCalledWith(`${API_URL}/habits/h1/complete`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: '{"id":"m1"}',
  })
})

test('un error devuelve el detail del servidor', async () => {
  stubFetch(409, { detail: 'Este hábito ya fue completado ese día' })
  await expect(send({ method: 'POST', path: '/x', body: {} })).rejects.toThrow('Este hábito ya fue completado ese día')
})

test('sin JSON cae al código HTTP', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 502 })))
  await expect(get('/habits')).rejects.toThrow('HTTP 502')
})

test('204 sin cuerpo no es un error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
  await expect(send({ method: 'DELETE', path: '/habits/h1' })).resolves.toBeNull()
})

test('sin red es ApiError 0, y no borra el token', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
  await expect(get('/habits')).rejects.toMatchObject({ status: 0 })
  expect(storage.remove).not.toHaveBeenCalled()
})

test('un 401 borra el token y avisa', async () => {
  const listener = vi.fn()
  const off = onUnauthorized(listener)
  stubFetch(401, { detail: 'Token inválido' })
  await expect(get('/habits')).rejects.toMatchObject({ status: 401 })
  expect(storage.remove).toHaveBeenCalledWith('grimoire-token')
  expect(listener).toHaveBeenCalledOnce()
  off()
})
