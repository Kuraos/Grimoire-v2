import { beforeEach, expect, test, vi } from 'vitest'
import { dueBetween, hashTaskId, reconcileReminders, reminderPlan, TASK_ID_MAX, TASK_ID_MIN, type PendingNotification } from './reminders'

const plugin = vi.hoisted(() => ({
  pending: [] as { id: number; body?: string; extra?: unknown }[],
  cancel: vi.fn(async (_: { notifications: { id: number }[] }) => {}),
  schedule: vi.fn(async (_: { notifications: { id: number; schedule: { at: Date } }[] }) => {}),
  display: 'granted',
}))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: async () => ({ notifications: plugin.pending }),
    cancel: plugin.cancel,
    schedule: plugin.schedule,
    cancelAll: () => { throw new Error('cancelAll borraría las de otros módulos') },
    requestPermissions: async () => ({ display: plugin.display }),
    createChannel: async () => {},
  },
}))
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: {} }))

const NOW = Date.parse('2026-11-01T12:00:00Z')
const LATER = '2026-11-01T13:00:00Z'
const LATEST = '2026-11-02T13:00:00Z'
const PAST = '2026-11-01T11:00:00Z'

const task = (over = {}) => ({ id: 'a', title: 'Leer', status: 'todo' as const, remind_at: LATER as string | null, ...over })
const agendada = (over: Partial<PendingNotification> & { taskId?: string; remindAt?: string } = {}) => {
  const { taskId = 'a', remindAt = LATER, ...rest } = over
  return { id: hashTaskId(taskId), body: 'Leer', extra: { kind: 'task', taskId, remindAt }, ...rest }
}
const POMODORO = { id: 7, body: 'Fin del pomodoro', extra: { kind: 'pomodoro' } }

beforeEach(() => {
  plugin.pending = []
  plugin.display = 'granted'
  plugin.cancel.mockClear()
  plugin.schedule.mockClear()
})

test('agenda una tarea abierta con hora futura, con su extra', () => {
  const { schedule, cancel } = reminderPlan([task()], [], NOW)
  expect(cancel).toEqual([])
  expect(schedule).toHaveLength(1)
  expect(schedule[0]).toMatchObject({ body: 'Leer', at: new Date(LATER), extra: { kind: 'task', taskId: 'a', remindAt: LATER } })
  expect(schedule[0].id).toBeGreaterThanOrEqual(TASK_ID_MIN)
  expect(schedule[0].id).toBeLessThanOrEqual(TASK_ID_MAX)
})

test('no toca lo que ya está igual: repetir la reconciliación no hace nada', () => {
  const first = reminderPlan([task()], [], NOW).schedule[0]
  const pending = [{ id: first.id, body: first.body, extra: first.extra }]
  expect(reminderPlan([task()], pending, NOW)).toEqual({ cancel: [], schedule: [] })
})

test('sin hora o ya completada no se agenda', () => {
  expect(reminderPlan([task({ remind_at: null }), task({ id: 'b', status: 'done' })], [], NOW).schedule).toEqual([])
})

test('completar cancela', () => {
  expect(reminderPlan([task({ status: 'done' })], [agendada()], NOW)).toEqual({ cancel: [agendada().id], schedule: [] })
})

test('borrar la tarea o quitarle la hora cancela', () => {
  expect(reminderPlan([], [agendada()], NOW).cancel).toEqual([agendada().id])
  expect(reminderPlan([task({ remind_at: null })], [agendada()], NOW).cancel).toEqual([agendada().id])
})

test('editar la hora reagenda con el mismo id', () => {
  const { cancel, schedule } = reminderPlan([task({ remind_at: LATEST })], [agendada()], NOW)
  expect(cancel).toEqual([agendada().id])
  expect(schedule.map((s) => [s.id, s.at, s.extra.remindAt])).toEqual([[agendada().id, new Date(LATEST), LATEST]])
})

test('editar el título reagenda: el aviso dice el nombre nuevo', () => {
  const { schedule } = reminderPlan([task({ title: 'Releer' })], [agendada()], NOW)
  expect(schedule[0].body).toBe('Releer')
})

test('una hora pasada no se agenda ni se dispara', () => {
  expect(reminderPlan([task({ remind_at: PAST })], [], NOW)).toEqual({ cancel: [], schedule: [] })
  expect(reminderPlan([task({ remind_at: new Date(NOW).toISOString() })], [], NOW).schedule).toEqual([])
})

test('editar a una hora pasada cancela y no agenda', () => {
  expect(reminderPlan([task({ remind_at: PAST })], [agendada()], NOW)).toEqual({ cancel: [agendada().id], schedule: [] })
})

test('una alarma con hora pasada y sin cambios se deja: puede estar a punto de sonar', () => {
  expect(reminderPlan([task({ remind_at: PAST })], [agendada({ remindAt: PAST })], NOW)).toEqual({ cancel: [], schedule: [] })
})

test('no toca notificaciones de otro kind ni sin extra', () => {
  const others = [POMODORO, { id: 8, body: 'x' }, { id: 9, body: 'x', extra: null }, { id: 10, body: 'x', extra: { taskId: 'a' } }]
  expect(reminderPlan([task({ status: 'done' })], others, NOW)).toEqual({ cancel: [], schedule: [] })
  expect(reminderPlan([], others, NOW).cancel).toEqual([])
})

test('al aplicar, lo de otro kind sigue ahí: solo se cancela lo de tareas', async () => {
  plugin.pending = [POMODORO, agendada()]
  await reconcileReminders([], NOW)
  expect(plugin.cancel.mock.calls[0][0].notifications).toEqual([{ id: agendada().id }])
  expect(plugin.schedule).not.toHaveBeenCalled()
})

test('un id ocupado por otro kind se salta, y no se le quita', () => {
  const ocupado = { ...POMODORO, id: hashTaskId('a') }
  const { schedule, cancel } = reminderPlan([task()], [ocupado], NOW)
  expect(cancel).toEqual([])
  expect(schedule[0].id).toBe(hashTaskId('a') + 1)
})

/** Dos ids con el mismo hash, buscados de verdad y no simulados. */
function colliding(): [string, string] {
  const byHash = new Map<number, string>()
  for (let i = 0; ; i++) {
    const id = `tarea-${i}`
    const h = hashTaskId(id)
    const other = byHash.get(h)
    if (other) return [other, id]
    byHash.set(h, id)
  }
}

test('colisión de hash: cada tarea queda con su id, también en la reconciliación siguiente', () => {
  const [x, y] = colliding()
  expect(hashTaskId(x)).toBe(hashTaskId(y))
  const tasks = [task({ id: x }), task({ id: y })]
  const { schedule } = reminderPlan(tasks, [], NOW)
  expect(new Set(schedule.map((s) => s.id)).size).toBe(2)
  expect(schedule.map((s) => s.extra.taskId).sort()).toEqual([x, y].sort())
  const pending = schedule.map((s) => ({ id: s.id, body: s.body, extra: s.extra }))
  expect(reminderPlan(tasks, pending, NOW)).toEqual({ cancel: [], schedule: [] })
  // la que ganó el hash se va: la otra conserva su id
  const left = reminderPlan([tasks[1]], pending, NOW)
  expect(left.schedule).toEqual([])
  expect(left.cancel).toHaveLength(1)
})

test('una tarea nueva no pisa el id de la que se está reagendando', () => {
  const [x, y] = colliding()
  const pending = [agendada({ taskId: x })]
  const { schedule } = reminderPlan([task({ id: x, remind_at: LATEST }), task({ id: y })], pending, NOW)
  expect(new Set(schedule.map((s) => s.id)).size).toBe(2)
})

test('dos agendadas para la misma tarea: queda una', () => {
  const dup = [agendada(), { ...agendada(), id: 5_000_000 }]
  expect(reminderPlan([task()], dup, NOW)).toEqual({ cancel: [5_000_000], schedule: [] })
})

test('los ids se quedan en su rango, también al dar la vuelta', () => {
  for (const id of ['', 'a', '019a0000-0000-7000-8000-000000000001', 'ñandú']) {
    const h = hashTaskId(id)
    expect(h).toBeGreaterThanOrEqual(TASK_ID_MIN)
    expect(h).toBeLessThanOrEqual(TASK_ID_MAX)
  }
})

test('al aplicar: cancela antes de agendar, y agenda con exacta, canal y extra', async () => {
  plugin.pending = [agendada()]
  const order: string[] = []
  plugin.cancel.mockImplementationOnce(async () => { order.push('cancel') })
  plugin.schedule.mockImplementationOnce(async () => { order.push('schedule') })
  await reconcileReminders([task({ remind_at: LATEST })], NOW)
  expect(order).toEqual(['cancel', 'schedule'])
  expect(plugin.schedule.mock.calls[0][0].notifications[0]).toMatchObject({
    channelId: 'recordatorios',
    schedule: { at: new Date(LATEST), allowWhileIdle: true },
    extra: { kind: 'task', taskId: 'a', remindAt: LATEST },
  })
})

test('sin permiso no agenda, pero cancela lo que ya no va', async () => {
  plugin.display = 'denied'
  plugin.pending = [agendada({ taskId: 'vieja' })]
  await reconcileReminders([task()], NOW)
  expect(plugin.cancel).toHaveBeenCalledOnce()
  expect(plugin.schedule).not.toHaveBeenCalled()
})

test('sin nada que agendar no pide permiso', async () => {
  const spy = vi.fn()
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  const original = LocalNotifications.requestPermissions
  LocalNotifications.requestPermissions = spy
  await reconcileReminders([task({ remind_at: null })], NOW)
  LocalNotifications.requestPermissions = original
  expect(spy).not.toHaveBeenCalled()
})

test('en web, solo lo que venció desde la última revisión, sin completadas', () => {
  const from = Date.parse(PAST) + 1
  const to = Date.parse(LATER)
  const due = dueBetween([task(), task({ id: 'p', remind_at: PAST }), task({ id: 'd', status: 'done' }), task({ id: 'f', remind_at: LATEST })], from, to)
  expect(due.map((t) => t.id)).toEqual(['a'])
})
