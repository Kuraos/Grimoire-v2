import { useEffect, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { isNative, notificationAccess, openExactSettings, type NotificationAccess } from "../../notify";
import { Card } from "./Card";

/** No se puede detectar ni activar desde la app (Hallazgos de la 2.2.6): solo se recuerda. */
export const AUTOSTART_HINT =
  "Para que suene con la app cerrada, Grimoire debe tener el inicio automático activado en el gestor del teléfono.";

/**
 * Solo en el APK, y solo si falta algo para que las notificaciones agendadas suenen a su hora
 * (ADR 0003). Lo usan Tareas y Pomodoro; `subject` dice qué no sonará.
 */
export function ReminderAccessNotice({ subject = "Los recordatorios" }: { subject?: string }) {
  const [access, setAccess] = useState<NotificationAccess>("ok");
  useEffect(() => {
    if (!isNative()) return;
    const check = () => { notificationAccess().then(setAccess).catch(() => {}); };
    check();
    // al volver de Ajustes
    const handle = CapApp.addListener("appStateChange", ({ isActive }) => { if (isActive) check(); });
    return () => { void handle.then((h) => h.remove()); };
  }, []);
  if (access === "ok") return null;
  return (
    <Card>
      <p className="gr-sangrado text-xs text-[var(--text-body)]">
        {access === "denied"
          ? `${subject} no sonarán: activa las notificaciones en Ajustes → Apps → Grimoire.`
          : `${subject} pueden sonar con retraso: Android los trata como inexactos.`}
      </p>
      {access === "inexact" && <button className="btn mt-2" onClick={() => void openExactSettings()}>Permitir alarmas exactas</button>}
    </Card>
  );
}
