# Fase 2.3 — Pomodoro de punta a punta

**Estado: plan aprobado por Johan el 2026-11-01.**

Depende de: Tareas (2.2), la cola sin conexión (2.1.6, ADR 0008), las notificaciones de la 2.2.6
(`app/src/notify.ts`, contrato de `kind` en el ADR 0003) y la caracterización de la v1
(`docs/tasks/caracterizacion-v1.md`, goldens en `api/crates/domain/tests/golden/pomodoro/`).

Objetivo: que Pomodoro funcione en la v2 como en la v1, con las diferencias de la tabla de abajo y
nada más, y que el fin de un bloque avise con la app cerrada. Es el tercer módulo del mínimo para
dejar la v1 (`ROADMAP.md`).

Cada tarea es una sesión de agente. Al terminar: verificación de `AGENTS.md` en verde, un commit
por tarea (`fase-2: <tarea>`) y una línea en «Hallazgos» si apareció algo. Si una tarea revela que
una decisión no se sostiene, se para y se anota, en vez de rodearla.

---

## Decisiones

La 1, la 2 y la 3 las fijó Johan al pedir este plan, y al aprobarlo ajustó la 1, la 2 y la 4
(2026-11-01). Las demás las propuso el plan, y Johan las aprobó con él.

1. **El temporizador vive en el cliente, con `ends_at` absoluto.** Se reutiliza
   `app/src/hooks/usePomodoro.ts`, ya portado: lo que queda se mide contra el reloj, no contra los
   ticks. Sin estado en el servidor y sin sincronizar entre dispositivos: un temporizador iniciado en
   el teléfono no se ve en el PC.
   - **La notificación se agenda al iniciar**, con `extra: { kind: "pomodoro", sessionId, phase, endsAt }`
     y `notify.ts`. Un solo id fijo, **`1000`**, dentro de los reservados 0–9 999 (ADR 0003): nunca hay
     dos temporizadores, y agendar de nuevo reemplaza al anterior. Agendar con un id existente reemplaza
     la notificación sin importar su `kind`, y por eso el hash de tareas nunca cae en ese rango.
   - **Se cancela al pausar, reiniciar, saltar o abandonar**, y se agenda otra vez al reanudar.
     También hay notificación para el fin del descanso.
   - **La reconciliación de tareas no la toca**, por el contrato de `kind`.
   - **Orden al iniciar:** primero se guarda el estado y luego se agenda. Si la notificación falla o no
     hay permiso, el temporizador corre igual y la vista lo dice.

2. **La sesión se registra según `ends_at`, no según cuándo llegó la notificación ni cuándo se abrió
   la app.** `finished_at` = `ends_at`, y `local_date` es su día en `America/Bogota` (invariante 3).
   - **Detectada vencida hasta 12 h después de `ends_at`, 12 h justas incluidas:** se registra completa,
     con XP y su hora real.
   - **Detectada más tarde:** se registra incompleta (0 XP, fuera de horas y totales), igual que una
     abandonada, con `work_minutes` = duración del bloque y su hora real. Decide el cliente al detectarla,
     una sola vez: esa request ya no cambia aunque tarde en sincronizar, y el servidor no aplica la regla.
   - `POST /pomodoro/sessions` lleva `id` del cliente, generado **al empezar el bloque** y guardado en
     el estado. Va por la cola de la 2.1.6: no cambia, y repetir da 200 sin efecto.
   - Es un cambio deliberado frente a la v1 (filas 26 y 34). Por eso **`restoreSnapshot` y su comentario se
     reescriben**, y una sesión abandonada sigue sin puntuar.
   - **Una sola cadena de fases:** si el bloque venció hace más de 5 s, ya sea con la app cerrada o
     congelada, el descanso **no** arranca solo: queda listo y en pausa. Así nada corre sin que nadie
     lo vea y no se encadenan descansos fantasma. Un descanso vencido no registra nada, y lo siguiente
     queda listo y en pausa. Con la app abierta y a tiempo, el descanso arranca solo, como en la v1.
   - **El reloj es el del dispositivo.** El servidor rechaza un `finished_at` más de 5 minutos en el
     futuro (422, visible como cualquier rechazo). No hay ventana de gracia hacia atrás: las sesiones
     no tienen rachas.

3. **Se mide el retraso de la notificación antes de construir** (2.3.1, ≥ 5 muestras con la app
   cerrada). En la 2.2.6 hubo uno de 2,5 min, con un solo caso y causa desconocida. Si alguna muestra
   pasa de **60 s**, se evalúa `setAlarmClock`.
   - **El plugin no lo usa:** en `@capacitor/local-notifications` 8.3.1 no aparece `setAlarmClock`, y una
     notificación con `at` va por `setExactAndAllowWhileIdle` (o `setAndAllowWhileIdle` sin el permiso).
     Adoptarlo exige un parche o un plugin propio en Kotlin, y por eso no se decide antes de medir.
   - **El retraso no puede dañar los datos:** por la decisión 2, solo atrasa el aviso.

4. **`PomodoroIsland` y `PomodoroTimer` se reutilizan.** Se porta `pages/Pomodoro.tsx` y un contexto
   equivalente a `pomodoro-context.tsx`, que no se copiaron. Cambios:
   - `activeTask` pasa a `ApiTask`.
   - La esfera deja de medir 320 px fijos en la base (`w-full max-w-[320px]`): en 393 px de ancho hay
     que comprobar que quepa dentro de la tarjeta.
   - **Pantalla completa: fuera de este módulo.** No existe ni en la v1 ni en la v2; queda en
     `ROADMAP.md`, «Después del cambio», y `DESIGN_SYSTEM.md` ya no la describe como existente.
   - La isla no se muestra en `/pomodoro`, como en la v1; en teléfono queda encima de la barra inferior.
   - Vuelve el botón «Iniciar pomodoro» de `TaskCard`, que quedó fuera de la 2.2.5.
   - `SIN_POMODORO` de `App.tsx` se reemplaza por el estado real, y `CommandPalette` y `PomodoroIsland`
     dejan el tipo `Task` de la v1. Si nadie más lo usa, `Task`, `Project` y `PomodoroSession` de la v1
     se borran de `types/index.ts`.

5. **Las horas por proyecto entran aquí, no en Estadísticas.** Están en la tarjeta de proyecto de la
   v1, que la 2.2.5 portó sin ese dato, y la fila 22 ya prometía que llegaban con Pomodoro. Dejarlas
   para la fase 5 sería perder una función visible al dejar la v1.
   - **Forma:** `pomodoro_minutes` entero en `GET /projects` (una suma de `work_minutes` completados).
     Las horas las calcula el cliente al mostrar (fila 31).
   - **Costo:** `GET /projects` costaba 2 ms de CPU, y esto le agrega una lectura que crece con los años.
     Se agrega con un índice `(project_id, completed)` y se mide con un seed de 5 000 sesiones. **Si la
     mediana pasa de 10 ms**, se cambia a un contador en `projects`, escrito en el mismo `batch` de la
     sesión. No se denormaliza antes de medir.
   - **Sin conexión:** la sesión pendiente suma sus minutos en la vista, como los conteos de la 2.2.5.

6. **Una sesión nunca se rechaza por una referencia que ya no existe.** Otro dispositivo puede haber
   borrado la tarea mientras el bloque corría, y perder 25 minutos y 15 XP por eso sería peor. El
   `INSERT` guarda `task_id` y `project_id` solo si existen, y `NULL` si no (filas 29 y 30). El proyecto
   heredado se resuelve en el servidor, como en la v1.

7. **Solo se concede con `completed: true`, una vez, en un solo `batch` condicionado**, como Hábitos y
   Tareas. `xp_log.mark_id` = id de la sesión. No hay deshacer: la v1 no lo tiene.

8. **Duración fijada al empezar.** El estado guarda los minutos del bloque, para que cambiar la
   configuración con el temporizador corriendo no altere lo registrado. `work_minutes` va de 1 a 90, el
   mismo límite del formulario de la v1. Una sesión incompleta de menos de 1 minuto no se registra.

9. **La configuración, el vínculo y el estado se guardan con `@capacitor/preferences`.** Son datos de
   este dispositivo, sin pasar por el servidor. La lista del día se guarda en disco, como las demás
   lecturas (`pomodoro/today` en `sync.ts`).

---

## Diferencias con la v1

Aprobadas con el plan. Están en «Diferencias permitidas» de `caracterizacion-v1.md`, filas 25 a 34.
También aplica la fila 4 (todos los logros desbloqueados en la respuesta).

| # | Diferencia | v1 (lo que graba el golden) | v2 | Motivo |
|---|---|---|---|---|
| 25 | `finished_at` y día de la sesión | Hora del servidor al recibir la request | `ends_at` del cliente; `local_date` guardado | Decisión 2. Una sesión sincronizada tarde conserva su día. |
| 26 | Fase vencida con la app cerrada | No se registra: vuelve agotada y en pausa | Se registra completa, con su hora real | Decisión 2, de Johan. Del cliente: ningún golden lo cubre. |
| 27 | Repetir el `POST` | Otra sesión y otros 15 XP | `id` obligatorio; repetir da 200 sin efecto | Contrato de la cola (ADR 0004). |
| 28 | Validación | 0, −5, 100 000 y un `started_at` en 2030 pagan (`validacion_sesion`) | 422 fuera de 1–90 minutos, si `started_at` ≥ `finished_at` o si `finished_at` está más de 5 min en el futuro | Es un bug. Solo en la API, sin `CHECK`, por si la migración trae valores así. |
| 29 | Referencia inexistente al crear | Guarda el id colgante (`task_id: 999`) | Guarda `NULL` y responde 200 | Decisión 6. |
| 30 | Borrar la tarea o el proyecto | La sesión conserva el id colgante | `ON DELETE SET NULL` | Mismo efecto visible: «Sesión libre». Se migra igual. |
| 31 | Horas del proyecto | `pomodoro_hours` con `round()` de float: 87 min → 1.4 | `pomodoro_minutes` entero; el cliente muestra horas con mitades hacia arriba: 87 min → 1.5 | Sin float en la API, como la fila 1. ±0,1 h solo en mitades exactas. Reemplaza a la fila 22. |
| 32 | `streak` en la respuesta | `null` | No se manda | No significa nada en una sesión. |
| 33 | `GET /pomodoro/range` | Existe; lo usa el calendario | No existe todavía | Llega con Calendario (fase 5+). Los datos se migran igual. |
| 34 | Sesión vencida detectada tarde | No se registra | Hasta 12 h tras `ends_at`: completa. Después: incompleta, sin XP y fuera de horas y totales | Decidido por Johan el 2026-11-01. Limita la fila 26. Del cliente: ningún golden lo cubre. |

---

## Alcance: la v1 frente a la v2

| v1 | v2 | Nota |
|---|---|---|
| `POST /pomodoro/sessions` | igual, con `id`, `started_at` y `finished_at` obligatorios | Respuesta: XP, `total_today_minutes` y `achievements_unlocked`. |
| `GET /pomodoro/today` | igual | Por `local_date`, de la más reciente a la más antigua. `task_title` con un `JOIN`. |
| `GET /pomodoro/range` | no | Fila 33. |
| `pomodoro_hours` en `/projects` | `pomodoro_minutes` | Fila 31. |
| `usePomodoro`, `PomodoroTimer`, `PomodoroIsland` | ya portados | Decisiones 1, 2 y 4. |
| `pages/Pomodoro.tsx`, `pomodoro-context.tsx` | se portan | Incluye log del día, recta de la jornada y configuración. |
| `notify()` y `playChime()` con la app abierta | notificación agendada y `playChime` | `playChime` ya está en `sounds.ts`. |

Fuera de alcance: las misiones de foco y el Diario que leen sesiones (llegan con sus módulos, y la
tabla ya tiene lo que necesitan), Calendario, Estadísticas y sincronizar el temporizador entre
dispositivos.

### Contrato con la cola

| Ruta | Repetirla da |
|---|---|
| `POST /pomodoro/sessions` | 200 sin efecto y sin XP: la sesión ya existe. |

### Notificaciones

| Campo | Valor |
|---|---|
| `id` | `1000`, fijo, en el rango reservado 0–9 999 |
| `extra` | `{ kind: "pomodoro", sessionId, phase, endsAt }` |
| Canal | `recordatorios`, de `notify.ts` |
| Dependencia en XOS | Inicio automático activado (Hallazgos de la 2.2.6) |

---

## 2.3.1 — Medir el retraso de la notificación

Primero, porque puede cambiar cómo se agenda. No toca código del repo: se agenda por el puerto de
depuración del WebView con `LocalNotifications.schedule`, `extra: { kind: "medicion" }` e ids propios.

- **Serie A, ≥ 5 muestras:** app cerrada con el proceso muerto y comprobado, pantalla bloqueada,
  conectado por USB. Es la condición más parecida al caso de la 2.2.6, donde `adb` respondió antes y
  después. Cada una anota la hora pedida, `Start proc … for broadcast` y `when` de la notificación.
- **Serie B, ≥ 5 muestras:** desconectado, con el teléfono quieto y el mismo cierre. La carga puede
  cambiar el comportamiento, y el uso real es sin cable. Se lee `when` de la bandeja al reconectar.
  Tras el primer disparo el proceso queda vivo un rato, así que se anota si cada una arrancó en frío.
- **Criterio:** retraso = entrega − hora pedida. Se reportan mediana y máximo por serie, **no** una
  estadística con pretensiones: son pocas muestras. Si alguna pasa de 60 s, se evalúa `setAlarmClock`
  contra la documentación de Android y su costo (parche o plugin propio; el icono de alarma en la barra
  de estado), se anota y **se para a preguntar**.
- **Coordinación con Johan:** el teléfono queda ocupado durante la serie A y sin cable en la B. Nada de
  tocar la pantalla o reiniciar sin avisar.

Terminado: tabla de muestras y decisión en «Hallazgos». Muestras de prueba descartadas.

## 2.3.2 — Esquema y dominio

- Migración `0006`: `pomodoro_sessions` (`id`, `task_id` y `project_id` con `ON DELETE SET NULL`,
  `work_minutes`, `completed`, `started_at`, `finished_at`, `local_date`) e índices por `local_date` y
  por `(project_id, completed)`.
- Dominio puro: validación (fila 28) y decisión de registrar (conceder 15 XP, repetición, incompleta), y
  `earned_on_pomodoro`, que recibe ya calculados el nivel y el conteo de completadas. Horas con mitades
  hacia arriba, en el cliente, con su test.
- `crates/domain/tests/golden_pomodoro.rs`: reproduce XP, nivel y logros de `sesion_xp`,
  `sesion_incompleta` y `logros_pomodoro`. Cada campo que no se compara cita su fila y afirma el valor
  de la v2. `validacion_sesion` afirma los rechazos de la fila 28.

Terminado: goldens de regla en verde, con las diferencias marcadas una por una.

## 2.3.3 — API

- `POST /pomodoro/sessions` en un solo `batch` condicionado. Test de concurrencia contra SQLite: dos
  requests con el mismo id, a partir del mismo estado leído, conceden una vez, y `users.xp` sigue siendo
  la suma de `xp_log`.
- `focus_centurion` y `focus_legend` solo consultan si siguen bloqueados. `GET /pomodoro/today` y
  `pomodoro_minutes` en `GET /projects`.
- `scripts/replay_golden.py` traduce los escenarios de sesiones y compara contra `wrangler dev`.
- Medir CPU de `POST` y de `GET /projects` con 5 000 sesiones sintéticas (decisión 5). Deploy y `0006`
  en remoto, solo cuando Johan lo pida.

Terminado: goldens contra `wrangler dev` con cada escritura repetida. Mediciones en «Hallazgos».

## 2.3.4 — Temporizador y capa de datos

- `usePomodoro.ts`: `sessionId` y minutos en el estado, y `restoreSnapshot` según la decisión 2. Los
  casos de `usePomodoro.test.ts` que afirman que lo vencido no se registra se reescriben a propósito,
  citando la fila 26. Las reglas de cierre quedan como funciones puras.
- `app/src/api/pomodoro.ts`: `sessionRequests`, `applyQueue` y hooks. `syncedSummary` agrega «1 sesión»
  al toast, y las horas pendientes se suman en `applyProjectQueue`.
- `app/src/pomodoroNotify.ts`: agendar y cancelar `kind: "pomodoro"`.
- Tests con arranques simulados, como `queue.test.ts`:
  - `ends_at` vencido al abrir: se registra una vez, con su hora real, también sin conexión.
  - Borde de las 12 h: justo 12 h, completa; un instante después, incompleta y sin XP.
  - Reiniciar la app antes de vencer: sigue corriendo y no duplica.
  - Doble apertura o crash después de encolar: mismo id.
  - Pausar y reiniciar cancelan; reanudar reagenda con el `ends_at` nuevo.
  - Abandonar registra incompleta y no paga; menos de 1 minuto no registra.
  - Cambiar la configuración a media sesión no altera los minutos.
  - El descanso vencido no registra y no se encadena.
  - La reconciliación de tareas no toca `kind: "pomodoro"`, ni al revés.
- Comprobar que los tests no pasan en vacío con mutaciones, registrando **qué test cae en cada una**.

Terminado: `npm run typecheck && npm test && npm run build` en verde.

## 2.3.5 — Vista Pomodoro

Portar `frontend/src/pages/Pomodoro.tsx` de la v1 (226 líneas), según `docs/DESIGN_SYSTEM.md`. En el
repo ya están `PomodoroTimer`, `PomodoroCycle`, `PomodoroIsland`, `SectionBand` y `Card`. No se crean
componentes salvo justificación en el commit.

- Mobile-first con el layout de la v1 en `lg:`. La esfera cabe en 393 px.
- `DayLine`: en táctil, tocar un bloque dice lo que en la v1 decía el `title`.
- `ReminderAccessNotice` pasa de `Tasks.tsx` a un lugar compartido, y también avisa aquí.
- Botón de iniciar desde `TaskCard`. Horas en la tarjeta de proyecto.

Terminado: capturas a 393 × 852 y 1280 × 800 del temporizador corriendo, en pausa, la isla y el log del
día, revisadas.

## 2.3.6 — Prueba en el teléfono

Johan, con el Infinix y contra la API desplegada (el deploy lo hace o lo autoriza él):

- Bloque corto con la app cerrada y la pantalla bloqueada: suena; al abrir, una sola sesión con la hora
  de `ends_at`, y `+15 XP` una sola vez.
- El mismo bloque, abriendo la app un rato después: la hora sigue siendo la de `ends_at`. Pasadas las
  12 h se comprueba en los tests, sin esperar en el teléfono.
- Modo avión durante el bloque: se registra al volver la señal, con su hora real.
- Pausar y reiniciar: no suena nada.
- Reinicio del teléfono con un bloque corriendo: se anota si sobrevive.

Terminado: **se consulta D1 antes de darlo por bueno**: una fila por bloque, `users.xp` = suma de
`xp_log` y `local_date` correcto.

---

## Migración

En el ADR 0006, «Sesiones de pomodoro».

---

## Hallazgos

(Agregar aquí lo que se descubra: mediciones, APIs que no funcionaron como dicen los docs, decisiones
tomadas sobre la marcha.)
