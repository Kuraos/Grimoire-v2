import { afterEach, expect, test, vi } from 'vitest'
import { API_URL, completeHabit, listHabits } from './api'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

test('manda el token y el id de la marca', async () => {
  const fetch = stubFetch(200, { xp_earned: 20 })
  await completeHabit('tok', 'h1', 'm1')
  expect(fetch).toHaveBeenCalledWith(`${API_URL}/habits/h1/complete`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: '{"id":"m1"}',
  })
})

test('un error devuelve el detail del servidor', async () => {
  stubFetch(409, { detail: 'Este hábito ya fue completado ese día' })
  await expect(completeHabit('tok', 'h1')).rejects.toThrow('Este hábito ya fue completado ese día')
})

test('sin JSON cae al código HTTP', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 502 })))
  await expect(listHabits('tok')).rejects.toThrow('HTTP 502')
})
