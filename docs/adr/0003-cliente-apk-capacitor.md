# ADR 0003 — Cliente Android como APK con Capacitor

Estado: aceptado (2026-10-29)

## Contexto

Se comparó PWA contra APK. La PWA gana en distribución y actualizaciones, pero Johan
prefirió empezar por APK por lo que la app hace con la pantalla apagada: recordatorios
a hora fija y un pomodoro que suene aunque Android congele la app.

## Decisión

APK construida con **Capacitor** sobre el frontend React. No Tauri móvil: con el backend
en Cloudflare, la capa Rust de Tauri en el teléfono no tendría trabajo, y añadiría NDK y
compilación cruzada como fuentes de fallo.

- Notificaciones: `@capacitor/local-notifications`. El pomodoro agenda una notificación
  exacta a la hora de fin en vez de mantener un temporizador vivo. Desde Android 14
  `SCHEDULE_EXACT_ALARM` viene negado por defecto: la app lo detecta
  (`checkExactNotificationSetting`) y lleva al usuario a Ajustes; si lo niega, cae a
  alarma inexacta y lo dice.
- Autenticación: token propio guardado en almacenamiento seguro del dispositivo, enviado
  como `Authorization: Bearer`. Cloudflare Access no encaja bien con una app nativa.
- Distribución: APK firmada publicada en GitHub Releases, instalada por sideload. Sin
  Play Store.
- PC: la misma app web servida por el Worker, en el navegador.

## Consecuencias

- Cada versión nativa implica reinstalar la APK en teléfono y tablet. Mitigación: aviso
  dentro de la app cuando hay versión nueva. Cambios solo de UI podrían ir por
  actualización del bundle web más adelante.
- Widgets de pantalla de inicio: posibles, pero en Kotlin. Fuera del MVP.
- La UI de la v1 es de escritorio (`minWidth: 980`, sidebar fija); hay que rediseñarla
  móvil primero, página por página.
