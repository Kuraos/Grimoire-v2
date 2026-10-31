import { expect, test, vi } from 'vitest'
import type { UserEvent } from '../types'
import { eventToast, unseenEvents } from './user'

vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: {} }))

const event = (over: Partial<UserEvent>): UserEvent => ({
  day: '2026-10-28', kind: 'life_lost', habits: ['Leer'], xp_penalty: 0, provisional: true, ...over,
})

test('un provisional que se asienta no se repite', () => {
  const first = unseenEvents([event({})], [])
  expect(first.fresh).toHaveLength(1)
  const second = unseenEvents([event({ provisional: false })], first.remember)
  expect(second.fresh).toEqual([])
})

test('el mismo día con otro desenlace sí se muestra', () => {
  // deshacer la marca que había dado el día perfecto
  const { remember } = unseenEvents([event({ kind: 'life_regained' })], [])
  expect(unseenEvents([event({ kind: 'life_lost' })], remember).fresh).toHaveLength(1)
})

test('lo recordado no crece sin límite', () => {
  const old = Array.from({ length: 80 }, (_, i) => `k${i}`)
  const { remember } = unseenEvents([event({})], old)
  expect(remember).toHaveLength(60)
  expect(remember).toContain('2026-10-28:life_lost')
})

test('los toasts dicen si son provisionales y no pintan de oro lo perdido', () => {
  const t = eventToast(event({ habits: ['Leer', 'Correr', 'Alemán'] }))
  expect(t.title).toContain('provisional')
  expect(t.body).toBe('Perdiste una vida (Leer y 2 más)')
  expect(t.variant).toBe('error')
  const fixed = eventToast(event({ kind: 'xp_penalty', xp_penalty: 15, provisional: false }))
  expect(fixed.title).not.toContain('provisional')
  expect(fixed.body).toBe('−15 XP (Leer)')
  expect(eventToast(event({ kind: 'life_regained', habits: [] })).variant).toBeUndefined()
})
