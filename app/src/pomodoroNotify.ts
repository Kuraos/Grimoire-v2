import { LocalNotifications } from '@capacitor/local-notifications'
import { ensureNotifications, isNative, NOTIFICATION_CHANNEL } from './notify'
import type { Phase, PomodoroSnapshot } from './hooks/usePomodoro'

/*
 * El aviso de fin de fase, con la app cerrada (decisión 1; ADR 0003). Hay un solo temporizador, así
 * que hay una sola notificación: id fijo `1000`, en el rango reservado. Agendar otra vez la
 * reemplaza. Este módulo solo toca ese id: nunca `cancelAll`, nunca otro `kind`, y la reconciliación
 * de tareas (`reminders.ts`) no la toca porque su `kind` no es `task`.
 */

export const POMODORO_NOTIFICATION_ID = 1000

export type PomodoroExtra = { kind: 'pomodoro'; sessionId: string | null; phase: Phase; endsAt: number }

/** `off`: no hay notificaciones agendadas (en web). `denied` y `failed`: el temporizador sigue, y la
 *  vista debe decirlo. */
export type PomodoroNotice = 'ok' | 'off' | 'denied' | 'failed'

export type PomodoroNotificationPlan =
  | { action: 'cancel' }
  | { action: 'schedule'; title: string; body: string; at: Date; extra: PomodoroExtra }

/** Corriendo: avisar al vencer. Detenido, por cualquier motivo: no debe quedar aviso. */
export function pomodoroNotificationPlan(t: PomodoroSnapshot): PomodoroNotificationPlan {
  if (!t.running || t.endsAt == null) return { action: 'cancel' }
  const work = t.phase === 'work'
  return {
    action: 'schedule',
    title: work ? 'Pomodoro completado' : 'Descanso terminado',
    body: work ? `${t.minutes} minutos de foco` : t.phase === 'long' ? 'Ciclo completo. Empieza uno nuevo.' : 'De vuelta al foco.',
    at: new Date(t.endsAt),
    extra: { kind: 'pomodoro', sessionId: t.sessionId, phase: t.phase, endsAt: t.endsAt },
  }
}

/** Deja la notificación de acuerdo con el estado. Se llama después de guardarlo. Nunca lanza. */
export async function syncPomodoroNotification(t: PomodoroSnapshot): Promise<PomodoroNotice> {
  if (!isNative()) return 'off'
  const plan = pomodoroNotificationPlan(t)
  try {
    if (plan.action === 'cancel') {
      await LocalNotifications.cancel({ notifications: [{ id: POMODORO_NOTIFICATION_ID }] })
      return 'ok'
    }
    if (!(await ensureNotifications())) return 'denied'
    await LocalNotifications.schedule({
      notifications: [{
        id: POMODORO_NOTIFICATION_ID,
        title: plan.title,
        body: plan.body,
        channelId: NOTIFICATION_CHANNEL,
        schedule: { at: plan.at, allowWhileIdle: true },
        extra: plan.extra,
      }],
    })
    return 'ok'
  } catch (e) {
    console.error('No se pudo agendar el aviso del pomodoro', e)
    return 'failed'
  }
}
