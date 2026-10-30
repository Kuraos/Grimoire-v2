import { LocalNotifications } from '@capacitor/local-notifications'

const CHANNEL = 'recordatorios'

/**
 * Agenda una notificación de prueba a 2 minutos. Devuelve un aviso si no quedó exacta.
 * Android 13 concede SCHEDULE_EXACT_ALARM al instalar; desde Android 14 viene negado
 * y el plugin cae solo a una alarma inexacta (ADR 0003).
 */
export async function scheduleTest(): Promise<string> {
  const perm = await LocalNotifications.requestPermissions()
  if (perm.display !== 'granted') {
    return 'Sin permiso de notificaciones: actívalo en Ajustes → Apps → Grimoire.'
  }
  // importancia 5 (alta): suena y aparece aunque la pantalla esté apagada
  await LocalNotifications.createChannel({
    id: CHANNEL,
    name: 'Recordatorios',
    importance: 5,
    vibration: true,
  })
  const exact = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 1,
        title: 'Grimoire',
        body: 'Prueba de recordatorio (2 min)',
        channelId: CHANNEL,
        schedule: { at: new Date(Date.now() + 2 * 60_000), allowWhileIdle: true },
      },
    ],
  })
  return exact === 'granted'
    ? 'Notificación exacta agendada para dentro de 2 minutos.'
    : 'Agendada como inexacta: Android puede retrasarla. Permite «Alarmas y recordatorios» para que sea exacta.'
}

export const needsExactPermission = async () =>
  (await LocalNotifications.checkExactNotificationSetting()).exact_alarm !== 'granted'

export const openExactSettings = () => LocalNotifications.changeExactNotificationSetting()
