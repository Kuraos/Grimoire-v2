import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

/**
 * Permisos y canal de las notificaciones agendadas (ADR 0003), para cualquier módulo: Tareas ahora
 * y Pomodoro después. Android 13 concede SCHEDULE_EXACT_ALARM al instalar; desde Android 14 viene
 * negado y el plugin cae solo a una alarma inexacta.
 */
export const NOTIFICATION_CHANNEL = 'recordatorios'

export type NotificationAccess = 'ok' | 'denied' | 'inexact'

export const isNative = () => Capacitor.isNativePlatform()

/** Pide el permiso si hace falta y crea el canal. `false`: no se puede agendar nada. */
export async function ensureNotifications(): Promise<boolean> {
  const perm = await LocalNotifications.requestPermissions()
  if (perm.display !== 'granted') return false
  // importancia 5 (alta): suena y aparece aunque la pantalla esté apagada
  await LocalNotifications.createChannel({
    id: NOTIFICATION_CHANNEL,
    name: 'Recordatorios',
    importance: 5,
    vibration: true,
  })
  return true
}

/** Solo mira, sin pedir nada: para decirle a Johan qué falta. */
export async function notificationAccess(): Promise<NotificationAccess> {
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return 'denied'
  const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting()
  return exact_alarm === 'granted' ? 'ok' : 'inexact'
}

export const openExactSettings = () => LocalNotifications.changeExactNotificationSetting()
