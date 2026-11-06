import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PomodoroSnapshot } from '../hooks/usePomodoro'
import type { ApiPomodoroSession, ApiProject } from '../types'

/** Sobrevive a `vi.resetModules()`: es el disco. */
const disk = vi.hoisted(() => new Map<string, string>())
const net = vi.hoisted(() => ({ connected: false, listener: null as null | ((s: { connected: boolean }) => void) }))
const log = vi.hoisted(() => [] as string[])
/** Para retener la escritura de la cola en disco, como un Preferences lento. */
const gate = vi.hoisted(() => ({ hold: false, holdAll: false, release: [] as (() => void)[] }))
const plugin = vi.hoisted(() => ({
  display: 'granted',
  scheduleFails: false,
  cancel: [] as { id: number }[][],
  schedule: [] as { id: number; schedule: { at: Date; allowWhileIdle: boolean }; channelId: string; extra: unknown }[][],
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: disk.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      if (gate.holdAll || (gate.hold && key === 'grimoire-queue-v1')) await new Promise<void>((r) => gate.release.push(r))
      log.push(`set ${key}`)
      disk.set(key, value)
    },
  },
}))
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: async () => ({ connected: net.connected }),
    addListener: async (_: string, fn: (s: { connected: boolean }) => void) => {
      net.listener = fn
      return { remove: async () => {} }
    },
  },
}))
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: { get: async () => 'tok', set: async () => {}, remove: async () => {} },
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    cancel: async ({ notifications }: { notifications: { id: number }[] }) => {
      log.push('cancel')
      plugin.cancel.push(notifications)
    },
    schedule: async ({ notifications }: { notifications: (typeof plugin.schedule)[number] }) => {
      if (plugin.scheduleFails) throw new Error('el plugin falló')
      log.push('schedule')
      plugin.schedule.push(notifications)
    },
    cancelAll: () => { throw new Error('cancelAll borraría las de otros módulos') },
    requestPermissions: async () => ({ display: plugin.display }),
    createChannel: async () => {},
  },
}))

const STATE_KEY = 'grimoire-pomodoro-v1'
const OUTBOX_KEY = 'grimoire-pomodoro-outbox-v1'
const QUEUE_KEY = 'grimoire-queue-v1'
const NOW = Date.parse('2026-03-02T17:00:00Z')
const MIN = 60_000
const SID = '019a0000-0000-7000-8000-0000000000aa'
const TASK = '019a0000-0000-7000-8000-0000000000bb'
const PROJECT = '019a0000-0000-7000-8000-0000000000cc'

let calls: { method: string; path: string; body: Record<string, unknown> }[]

const sessionOut = { xp_earned: 15, new_xp: 15, new_level: 1, title: 'Iniciado', leveled_up: false, total_today_minutes: 25, achievements_unlocked: [] }

function stubFetch() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    calls.push({ method: init.method!, path, body: init.body ? JSON.parse(init.body as string) : undefined })
    return new Response(JSON.stringify(path.startsWith('/pomodoro/sessions') ? sessionOut : []), { status: 200 })
  }))
}

/** Un bloque de 25 min que arrancó en `start`, corriendo, guardado en disco con su vínculo. */
function storeBlock(start: number) {
  const timer: PomodoroSnapshot = {
    phase: 'work', running: true, endsAt: start + 25 * MIN, remainingMs: 25 * MIN, workCount: 1,
    workStartedAt: start, minutes: 25, sessionId: SID,
  }
  disk.set(STATE_KEY, JSON.stringify({ config: { work: 25, short: 5, long: 15 }, links: { taskId: TASK, projectId: null }, timer }))
}

/** Un arranque de la app: módulos nuevos, lo mismo en disco. */
async function start(now: number) {
  vi.setSystemTime(now)
  vi.resetModules()
  const q = await import('./queryClient')
  const sync = await import('./sync')
  const client = await import('./client')
  const pomodoro = await import('./pomodoro')
  q.queryClient.mount()
  await sync.bootSync()
  await client.loadToken()
  sync.setAuthorized(true)
  const booted = await pomodoro.bootPomodoro(now)
  return { q, pomodoro, booted }
}

const settle = () => vi.advanceTimersByTimeAsync(10)
const goOnline = async () => {
  net.connected = true
  net.listener?.({ connected: true })
  await settle()
  await settle()
}
const queuedSessions = (q: Awaited<ReturnType<typeof start>>['q']) =>
  q.queryClient.getMutationCache().getAll().map((m) => (m.state.variables as { body: { id: string; completed: boolean } }).body)
const onDisk = () => JSON.parse(disk.get(QUEUE_KEY) ?? '[]') as unknown[]

beforeEach(() => {
  vi.useFakeTimers()
  disk.clear()
  log.length = 0
  gate.hold = false
  gate.holdAll = false
  gate.release = []
  net.connected = false
  net.listener = null
  plugin.display = 'granted'
  plugin.scheduleFails = false
  plugin.cancel = []
  plugin.schedule = []
  stubFetch()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------- Arranques ----------

test('vencido al abrir sin conexión: se encola una vez, con su hora real, y sobrevive a reiniciar', async () => {
  const startedAt = NOW - 3 * 60 * MIN
  storeBlock(startedAt)
  const first = await start(NOW)
  expect(queuedSessions(first.q)).toEqual([{
    id: SID, task_id: TASK, project_id: null, work_minutes: 25, completed: true,
    started_at: '2026-03-02T14:00:00Z', finished_at: '2026-03-02T14:25:00Z',
  }])
  expect(first.booted.timer).toMatchObject({ phase: 'short', running: false, sessionId: null })
  expect(onDisk()).toHaveLength(1)
  expect(JSON.parse(disk.get(OUTBOX_KEY)!)).toEqual([])
  first.q.queryClient.unmount()

  // otro arranque, aún sin señal: nada nuevo
  const second = await start(NOW + 10 * MIN)
  expect(queuedSessions(second.q).map((b) => b.id)).toEqual([SID])
  await goOnline()
  expect(calls.filter((c) => c.path === '/pomodoro/sessions').map((c) => c.body.id)).toEqual([SID])
})

test('vencido al abrir con conexión: se manda una vez y el siguiente arranque no lo repite', async () => {
  net.connected = true
  storeBlock(NOW - 30 * MIN)
  const first = await start(NOW)
  await settle()
  await settle()
  expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /pomodoro/sessions')
  first.q.queryClient.unmount()
  calls = []
  await start(NOW + MIN)
  await settle()
  expect(calls.filter((c) => c.path === '/pomodoro/sessions')).toEqual([])
})

test('12 h justas: completa; un instante después: incompleta, y nunca sin id', async () => {
  storeBlock(NOW - 12 * 60 * MIN - 25 * MIN)
  const exact = await start(NOW)
  expect(queuedSessions(exact.q)).toMatchObject([{ id: SID, completed: true }])
  exact.q.queryClient.unmount()

  disk.clear()
  storeBlock(NOW - 12 * 60 * MIN - 25 * MIN)
  const late = await start(NOW + 1)
  expect(queuedSessions(late.q)).toMatchObject([{ id: SID, completed: false, work_minutes: 25, finished_at: '2026-03-02T05:00:00Z' }])
})

test('reiniciar antes de vencer: sigue corriendo y no encola nada', async () => {
  storeBlock(NOW - 10 * MIN)
  const first = await start(NOW)
  expect(queuedSessions(first.q)).toEqual([])
  expect(first.booted.timer).toMatchObject({ running: true, sessionId: SID })
  first.q.queryClient.unmount()
  const second = await start(NOW + MIN)
  expect(queuedSessions(second.q)).toEqual([])
  expect(second.booted.timer.endsAt).toBe(NOW + 15 * MIN)
})

test('crash con la decisión en la bandeja: se encola la de la bandeja, aunque ahora se decidiría otra cosa', async () => {
  // a las 11 h se decidió «completa»; el proceso murió antes de guardar el estado nuevo
  const startedAt = NOW - 25 * MIN - 11 * 60 * MIN
  storeBlock(startedAt)
  const first = await start(NOW)
  const decided = JSON.parse(disk.get(QUEUE_KEY)!)
  first.q.queryClient.unmount()
  disk.delete(QUEUE_KEY)
  storeBlock(startedAt)
  disk.set(OUTBOX_KEY, JSON.stringify([decided[0].state.variables]))

  // vuelve 2 h después: recalcular daría «incompleta», pero la request no se recalcula
  const second = await start(NOW + 2 * 60 * MIN)
  expect(queuedSessions(second.q)).toEqual([expect.objectContaining({ id: SID, completed: true })])
  expect(JSON.parse(disk.get(OUTBOX_KEY)!)).toEqual([])
})

test('crash después de encolar, con la bandeja sin vaciar: el mismo id, una sola vez', async () => {
  storeBlock(NOW - 60 * MIN)
  const first = await start(NOW)
  const request = (JSON.parse(disk.get(QUEUE_KEY)!)[0] as { state: { variables: unknown } }).state.variables
  first.q.queryClient.unmount()
  // la cola llegó a disco, pero ni la bandeja se vació ni el estado se guardó
  disk.set(OUTBOX_KEY, JSON.stringify([request]))
  storeBlock(NOW - 60 * MIN)
  const second = await start(NOW + MIN)
  expect(queuedSessions(second.q).map((b) => b.id)).toEqual([SID])
  // doble apertura: registrar otra vez lo mismo tampoco duplica
  await second.pomodoro.recordSession(request as never)
  expect(queuedSessions(second.q).map((b) => b.id)).toEqual([SID])
})

test('la bandeja se vacía solo cuando la cola ya está en disco', async () => {
  const { pomodoro, q } = await start(NOW)
  const request = pomodoro.sessionRequests.create(
    { sessionId: SID, minutes: 8, startedAt: NOW - 8 * MIN, finishedAt: NOW, completed: false },
    { taskId: null, projectId: null },
  )
  gate.hold = true
  const done = pomodoro.recordSession(request)
  await settle()
  // encolada en memoria, pero la cola aún no llega a disco: la bandeja la conserva
  expect(queuedSessions(q)).toMatchObject([{ id: SID, completed: false, work_minutes: 8 }])
  expect(JSON.parse(disk.get(OUTBOX_KEY)!)).toEqual([request])
  gate.hold = false
  gate.release.forEach((r) => r())
  await done
  expect(onDisk()).toHaveLength(1)
  expect(JSON.parse(disk.get(OUTBOX_KEY)!)).toEqual([])
})

test('dos decisiones para el mismo id en la bandeja: se encola la primera', async () => {
  const { sessionRequests } = await import('./pomodoro')
  const decide = (completed: boolean) => sessionRequests.create(
    { sessionId: SID, minutes: 25, startedAt: NOW - 25 * MIN, finishedAt: NOW, completed },
    { taskId: null, projectId: null },
  )
  disk.set(OUTBOX_KEY, JSON.stringify([decide(true), decide(false)]))
  const { q } = await start(NOW)
  expect(queuedSessions(q)).toEqual([expect.objectContaining({ id: SID, completed: true })])
})

test('al cerrar un bloque, la sesión entra a la fila de disco antes que el estado sin su id', async () => {
  const { pomodoro } = await start(NOW)
  const { commitTransition, closePhase, DEFAULT_CONFIG } = await import('../hooks/usePomodoro')
  const links = { taskId: null, projectId: null }
  const tr = closePhase({
    phase: 'work', running: true, endsAt: NOW, remainingMs: 0, workCount: 0,
    workStartedAt: NOW - 25 * MIN, minutes: 25, sessionId: SID,
  }, NOW + 1_000, DEFAULT_CONFIG)
  // el contexto más impaciente: guarda en el mismo instante en que cambia el estado
  gate.holdAll = true
  log.length = 0
  commitTransition(
    tr,
    (next) => void pomodoro.savePomodoro({ config: DEFAULT_CONFIG, links, timer: next }),
    (r) => void pomodoro.recordSession(pomodoro.sessionRequests.create(r, links)),
  )
  // soltar las escrituras de una en una: cada una puede dejar en fila la siguiente
  for (let i = 0; i < 20 && log.filter((l) => l === `set ${STATE_KEY}`).length === 0; i++) {
    await settle()
    gate.release.splice(0).forEach((r) => r())
  }
  gate.holdAll = false
  gate.release.splice(0).forEach((r) => r())
  await settle()
  expect(log.indexOf(`set ${OUTBOX_KEY}`)).toBeGreaterThanOrEqual(0)
  expect(log.indexOf(`set ${OUTBOX_KEY}`)).toBeLessThan(log.indexOf(`set ${STATE_KEY}`))
  // y para cuando el estado llega a disco, la sesión ya está en la cola guardada
  expect(log.indexOf(`set ${QUEUE_KEY}`)).toBeLessThan(log.indexOf(`set ${STATE_KEY}`))
})

// ---------- Notificación ----------

const running = (endsAt: number): PomodoroSnapshot => ({
  phase: 'work', running: true, endsAt, remainingMs: 25 * MIN, workCount: 0, workStartedAt: endsAt - 25 * MIN, minutes: 25, sessionId: SID,
})
const state = (timer: PomodoroSnapshot) => ({ config: { work: 25, short: 5, long: 15 }, links: { taskId: null, projectId: null }, timer })

test('guardar primero y agendar después: id 1000, su canal, allowWhileIdle y el extra de pomodoro', async () => {
  const { pomodoro } = await start(NOW)
  log.length = 0
  plugin.schedule = []
  expect(await pomodoro.savePomodoro(state(running(NOW + 25 * MIN)))).toBe('ok')
  expect(log).toEqual([`set ${STATE_KEY}`, 'schedule'])
  expect(plugin.schedule).toEqual([[{
    id: 1000, title: 'Pomodoro completado', body: '25 minutos de foco', channelId: 'recordatorios',
    schedule: { at: new Date(NOW + 25 * MIN), allowWhileIdle: true },
    extra: { kind: 'pomodoro', sessionId: SID, phase: 'work', endsAt: NOW + 25 * MIN },
  }]])
})

test('pausar y reiniciar cancelan solo el 1000; reanudar reagenda con el ends_at nuevo', async () => {
  const { pomodoro } = await start(NOW)
  const { pauseTimer, startTimer, resetTimer, DEFAULT_CONFIG } = await import('../hooks/usePomodoro')
  plugin.cancel = []
  plugin.schedule = []
  const run = running(NOW + 25 * MIN)
  const paused = pauseTimer(run, NOW + 5 * MIN)
  await pomodoro.savePomodoro(state(paused))
  const resumed = startTimer(paused, NOW + 30 * MIN, DEFAULT_CONFIG)
  await pomodoro.savePomodoro(state(resumed))
  await pomodoro.savePomodoro(state(resetTimer(resumed, NOW + 31 * MIN, DEFAULT_CONFIG).next))
  expect(plugin.cancel).toEqual([[{ id: 1000 }], [{ id: 1000 }]])
  expect(plugin.schedule.map((n) => n[0].schedule.at.getTime())).toEqual([NOW + 50 * MIN])
})

test('sin permiso o si el plugin falla, el estado queda guardado y la vista se entera', async () => {
  const { pomodoro } = await start(NOW)
  plugin.display = 'denied'
  expect(await pomodoro.savePomodoro(state(running(NOW + 25 * MIN)))).toBe('denied')
  plugin.display = 'granted'
  plugin.scheduleFails = true
  expect(await pomodoro.savePomodoro(state(running(NOW + 26 * MIN)))).toBe('failed')
  expect(JSON.parse(disk.get(STATE_KEY)!).timer.endsAt).toBe(NOW + 26 * MIN)
})

test('el aviso del descanso es otra fase, mismo id', async () => {
  const { pomodoroNotificationPlan } = await import('../pomodoroNotify')
  const brk: PomodoroSnapshot = { ...running(NOW + 5 * MIN), phase: 'long', minutes: 15, sessionId: null, workStartedAt: null }
  expect(pomodoroNotificationPlan(brk)).toMatchObject({ action: 'schedule', title: 'Descanso terminado', extra: { kind: 'pomodoro', phase: 'long', sessionId: null } })
})

test('reconciliar tareas no toca el aviso del pomodoro, ni el pomodoro las de tareas', async () => {
  const { reminderPlan } = await import('../reminders')
  const { pomodoroNotificationPlan, POMODORO_NOTIFICATION_ID } = await import('../pomodoroNotify')
  const plan = pomodoroNotificationPlan(running(NOW + 25 * MIN))
  if (plan.action !== 'schedule') throw new Error('debía agendar')
  const pomodoroPending = { id: POMODORO_NOTIFICATION_ID, body: plan.body, extra: plan.extra }
  // tareas: sin tareas con recordatorio, cancela todo lo suyo y nada más
  const task = { id: 'a', body: 'Leer', extra: { kind: 'task', taskId: 'a', remindAt: '2026-03-02T18:00:00Z' } }
  expect(reminderPlan([], [pomodoroPending, { ...task, id: 1_000_123 }], NOW).cancel).toEqual([1_000_123])
  // pomodoro: detenerse cancela solo su id, sin mirar lo agendado
  const { pomodoro } = await start(NOW)
  plugin.cancel = []
  const { pauseTimer } = await import('../hooks/usePomodoro')
  await pomodoro.savePomodoro(state(pauseTimer(running(NOW + 25 * MIN), NOW)))
  expect(plugin.cancel).toEqual([[{ id: 1000 }]])
})

// ---------- La vista con la cola encima ----------

const pending = (body: Record<string, unknown>, status: 'pending' | 'success' | 'error' = 'pending') =>
  ({ request: { method: 'POST' as const, path: '/pomodoro/sessions', body }, status })
const body = (over: Record<string, unknown> = {}) => ({
  id: SID, task_id: null, project_id: null, work_minutes: 25, completed: true,
  started_at: '2026-03-02T16:35:00Z', finished_at: '2026-03-02T17:00:00Z', ...over,
})
const server = (over: Partial<ApiPomodoroSession> = {}): ApiPomodoroSession => ({
  id: 'srv', task_id: null, project_id: null, work_minutes: 30, completed: true,
  started_at: '2026-03-02T13:00:00Z', finished_at: '2026-03-02T13:30:00Z', task_title: null, ...over,
})

test('una sesión pendiente se ve en su día, con el proyecto y el título de su tarea', async () => {
  const { applySessionQueue, focusMinutes } = await import('./pomodoro')
  const tasks = [{ id: TASK, title: 'Tesis', project_id: PROJECT }]
  const { sessions, pendingIds } = applySessionQueue([server()], [pending(body({ task_id: TASK }))], '2026-03-02', tasks)
  expect(sessions.map((s) => s.id)).toEqual([SID, 'srv'])
  expect(sessions[0]).toMatchObject({ project_id: PROJECT, task_title: 'Tesis' })
  expect(pendingIds).toEqual(new Set([SID]))
  expect(focusMinutes(sessions)).toBe(55)
  // otro día, rechazada, o ya traída por el servidor: no se suma
  expect(applySessionQueue([], [pending(body())], '2026-03-03').sessions).toEqual([])
  expect(applySessionQueue([], [pending(body(), 'error')], '2026-03-02').sessions).toEqual([])
  expect(applySessionQueue([server({ id: SID })], [pending(body(), 'success')], '2026-03-02').sessions).toHaveLength(1)
  // el día es el de Bogotá: las 23:30 del 2 son el 3 en UTC
  expect(applySessionQueue([], [pending(body({ finished_at: '2026-03-03T04:30:00Z' }))], '2026-03-02').sessions).toHaveLength(1)
  // una incompleta se ve, pero no suma
  expect(focusMinutes(applySessionQueue([], [pending(body({ completed: false }))], '2026-03-02').sessions)).toBe(0)
})

test('el total de una sesión sincronizada dice de qué día es: tarde, no es hoy', async () => {
  const { sessionDayTotal } = await import('./pomodoro')
  const r = (finished_at: string) => ({ request: pending(body({ finished_at })).request, data: { ...sessionOut, total_today_minutes: 75 }, ageMs: 90_000_000 })
  vi.setSystemTime(NOW + 24 * 60 * MIN)
  expect(sessionDayTotal(r('2026-03-02T17:00:00Z'))).toEqual({ day: '2026-03-02', minutes: 75 })
  expect(sessionDayTotal(r('2026-03-03T03:00:00Z'))).toEqual({ day: '2026-03-02', minutes: 75 })
  expect(sessionDayTotal({ request: { method: 'POST', path: '/tasks/a/complete' }, data: {}, ageMs: 0 })).toBeNull()
})

test('las sesiones en cola suman sus minutos a su proyecto, también el heredado de la tarea', async () => {
  const { applyProjectQueue } = await import('./projects')
  const project = (id: string): ApiProject => ({
    id, name: id, description: null, status: 'active', color: '#9b7fc4', category: null,
    created_at: '2026-01-01T05:00:00Z', tasks_total: 1, tasks_pending: 1, pomodoro_minutes: 60,
  })
  const task = { id: TASK, title: 'x', project_id: 'q' } as never
  const { projects } = applyProjectQueue([project('p'), project('q')], [
    pending(body({ id: 'a', project_id: 'p' })),
    pending(body({ id: 'b', project_id: 'p', completed: false })),
    pending(body({ id: 'c', project_id: 'p' }), 'error'),
    pending(body({ id: 'd', task_id: TASK, work_minutes: 27 })),
    // un proyecto explícito manda sobre el de la tarea
    pending(body({ id: 'e', task_id: TASK, project_id: 'p', work_minutes: 2 })),
  ], [task])
  expect(projects.map((p) => [p.id, p.pomodoro_minutes, p.tasks_total])).toEqual([['p', 87, 1], ['q', 87, 1]])
})

test('el toast cuenta sesiones aparte, y una incompleta no cuenta', async () => {
  const { summarizeResults, syncedSummary } = await import('./user')
  const r = (path: string, xp_earned: number) => ({ request: { method: 'POST' as const, path }, data: { ...sessionOut, xp_earned }, ageMs: 90_000 })
  const say = (...rs: ReturnType<typeof r>[]) => syncedSummary(summarizeResults(rs))
  expect(say(r('/pomodoro/sessions', 15))).toBe('1 sesión · +15 XP')
  expect(say(r('/pomodoro/sessions', 15), r('/pomodoro/sessions', 15), r('/pomodoro/sessions', 0))).toBe('2 sesiones · +30 XP')
  expect(say(r('/habits/h/complete', 20), r('/pomodoro/sessions', 15))).toBe('1 marca · 1 sesión · +35 XP')
  expect(say(r('/pomodoro/sessions', 0))).toBeNull()
})
