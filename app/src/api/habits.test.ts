import { expect, test, vi } from 'vitest'
import { habitRequests, localDate } from './habits'
import { queryClient } from './queryClient'

vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: {} }))

const HABIT = { id: 'h1', name: 'Leer' }

test('el día de la marca es el de Bogotá, no el del dispositivo', () => {
  // 02:00 UTC del 1 de noviembre son las 21:00 del 31 de octubre en Bogotá
  expect(localDate(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10-31')
  expect(localDate(new Date('2026-11-01T05:00:00Z'))).toBe('2026-11-01')
})

test('una marca nace con su id y su día, y sobrevive a JSON', () => {
  const now = new Date('2026-10-31T17:00:00Z')
  const a = habitRequests.complete(HABIT, now)
  const b = habitRequests.complete(HABIT, now)
  expect(a.body).toMatchObject({ local_date: '2026-10-31' })
  expect((a.body as { id: string }).id).not.toBe((b.body as { id: string }).id)
  expect(JSON.parse(JSON.stringify(a))).toEqual(a)
})

// lo que la 2.1.6 necesita: restaurar de disco y reanudar sin el hook que la creó
test('una mutación reanudada encuentra su función por la clave', () => {
  const defaults = queryClient.getMutationDefaults(['api'])
  expect(defaults.mutationFn).toBeTypeOf('function')
  expect(defaults.scope).toEqual({ id: 'api' })
})
