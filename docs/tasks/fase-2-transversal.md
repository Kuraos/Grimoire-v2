# Fase 2.5 — Lo transversal e Inicio mínimo

**Estado: aprobado por Johan el 2026-11-15.**

Depende de: los cuatro módulos de la fase 2 (Hábitos, Tareas, Pomodoro, Diario), la cola sin conexión
(ADR 0008) y la caracterización de la v1 (`docs/tasks/caracterizacion-v1.md`).

Objetivo: el punto 5 del «Mínimo para dejar la v1» de `ROADMAP.md`: usuario (XP, nivel, título,
vidas), Inicio mínimo (lo de hoy), autenticación y modo sin conexión, en el teléfono, la tablet y el
PC. Es lo último de la fase 2. Hoy el XP y el nivel no se ven en ninguna pantalla (lo notó Johan en
la 2.4.6).

Cada tarea es una sesión de agente. Al terminar: verificación de `AGENTS.md` en verde, un commit
por tarea (`fase-2: <tarea>`) y una línea en «Hallazgos» si apareció algo. Si una tarea revela que
una decisión no se sostiene, se para y se anota, en vez de rodearla.

---

## Inventario: lo que ya existe en la v2

Comprobado en el código el 2026-11-15 (`main` en `cb1bc66`), no supuesto.

| Pieza | Estado | Dónde | Qué falta |
|---|---|---|---|
| `GET /user` | **Hecho** | `api/crates/worker/src/user.rs` | Devuelve XP, nivel, título, vidas provisionales, `xp_into_level`, `xp_span` y los eventos de vidas; asienta los días pendientes (ADR 0005). CPU en producción (2.1.x, seed de la 0.3): mediana 8,5 ms, 7 de 20 sobre 10 ms. **El cálculo de nivel (`respond`, el `_enrich` de la v1) vive en el worker, fuera de `domain`**: los goldens graban los cuatro campos de progreso, pero ningún test los compara (lista en la 2.5.1). |
| `PATCH /user` | **No existe** | — | Queda así hasta Ajustes (decisión E). |
| `useUser` | **Hecho** | `app/src/api/user.ts` | `['user']` va a disco (`PERSISTED_QUERIES` en `sync.ts`). Se refresca después de cada lote de escrituras (`invalidateQueries` en `queryClient.ts`) y al volver a la app (2.1.5); sin el sondeo de 30 s de la v1. |
| Vidas en `TopBar` | **Hecho** | `components/layout/TopBar.tsx` | Tres corazones en todos los tamaños. Nombre y título solo en `lg:`. **XP y nivel no se ven en ningún tamaño.** |
| `XPBar` | **A medias** | `components/ui/XPBar.tsx` | Portado y adaptado a props (`user` en vez de `useUser()`, su `TODO(fase-2)`). Ninguna vista lo usa. |
| `LevelUpOverlay` | **Hecho** | `App.tsx`, `context.tsx` | Montado; lo dispara `onSyncResults` con el ascenso más alto del lote. |
| Toasts y logros de `context.tsx` | **Hecho** | `context.tsx`, `api/user.ts` | Errores de API (sin repetir en 4 s), eventos de vidas (una vez, recordados en `localStorage`), «Sincronizado · …» y un toast por logro. No hay vista de logros (fase 5+); `NextAchievement` no se usa. |
| `TokenGate` y el token | **A medias** | `TokenGate.tsx`, `api/client.ts` | Pide el token una vez, lo guarda en el Keystore (`@aparajita/capacitor-secure-storage`; en web cae a `localStorage`, visto en `dist/esm/web.js`), y ante un 401 lo vuelve a pedir y pausa la cola sin perderla. Falta: un token por dispositivo (decisión C). |
| Cola y toast de sincronización | **Hecho** | `api/sync.ts`, `api/queryClient.ts`, ADR 0008 | Cola y caché en disco, en línea = red **y** token, toast con el resumen de lo que llegó tarde. **No hay aviso global de «sin conexión» ni de pendientes**: la v1 tenía una franja bajo `TopBar`. Hoy cada vista lo dice a su modo (Hábitos, Tareas, búsqueda del Diario). |
| `GET /diary/{día}/summary` | **No existe como ruta** | `worker/src/diary.rs`, `day` | El resumen viene dentro de `GET /diary/{día}` (decisión 7 del Diario): un `batch` de 5 consultas (entrada, conflictos, hábitos del día, sesiones del día, `xp_log` de un día antes a uno después). CPU en producción: mediana 2 ms (2.4.6). |
| Ruta `/` | **No existe la vista** | `App.tsx` | Es `Pendiente`. `BottomNav` y `Sidebar` ya la ponen primera, como «Inicio», y la app arranca ahí. |
| La v2 en el PC | **No existe** | `lib.rs`, `wrangler.toml` | El comentario de `lib.rs` dice que el worker sirve la web, pero `wrangler.toml` no tiene `assets` y `GET /` responde **401** (comprobado el 2026-11-15). `CORS_ORIGIN` es solo `https://localhost` (la APK). |
| Componentes del Inicio de la v1 | **Portados** | `components/` | `HabitRow`, `QuestsCard`, `EnergyCheckin` y `DaySigil` sin uso; `TaskCard`, `PomodoroTimer`, `MiniCalendar`, `SectionBand` y `Card` en uso. `streakMultiplier` está en `utils.ts` y `sortTasks` en `api/tasks.ts`. |

---

## Lo que hace el Inicio de la v1

`frontend/src/pages/Dashboard.tsx` (280 líneas). Al abrir pide `listHabits()`,
`listTasks("?completed=false&sort=priority")` (se queda con 4), `getCheckin(hoy)` y
`daySummary(hoy)` (`GET /diary/{día}/summary`); y aparte `listEvents` del mes y `stats("year")` para
las marcas del minicalendario. El contexto sondea `GET /user` cada 30 s y muestra la franja de sin
conexión. Lo que entra en la v2, aprobado por Johan:

| # | Tarjeta | Qué muestra en la v1 | En la v2 | Razón |
|---|---|---|---|---|
| 1 | Cabecera «Hoy» | «X de N hábitos · XP · min de foco» | **Dentro** | Sale de los mismos datos que 3 y 10. |
| 2 | `XPBar` | Nivel, título, bono de racha (`streakMultiplier` de la **mejor** racha entre los hábitos), «+XP hoy» y la barra al siguiente nivel | **Dentro** | Es lo que hoy no se ve en ningún lado. Ya portado. El «XP hoy» sigue la fila 43. |
| 3 | Hábitos de hoy (`rubric`) | Los hábitos activos agrupados por categoría (`SectionBand` + `HabitRow`), marcar y deshacer; tocar uno lleva a `/habitos` | **Dentro** | Es el bucle diario. `habitActions` y `applyQueue` ya existen; `GET /habits` ya está en disco. |
| 4 | Pomodoro | `PomodoroTimer` pequeño, empezar o pausar, botón a `/pomodoro` | **Dentro** | `pomodoro-context` ya existe; no lee nada nuevo. |
| 5 | Misiones (`QuestsCard`) | Misiones del día y reclamarlas | **Fuera** | Misiones es fase 5+; no hay API ni tablas en la v2. |
| 6 | Energía / Ánimo (`EnergyCheckin`) | Check-in del día, 5 XP | **Fuera** | Check-ins es fase 5+ (como la fila 36 en el Diario). Los datos se migran igual. |
| 7 | Tareas prioritarias | Las 4 primeras abiertas por prioridad, completar | **Dentro** | `useTasks` ya está en disco y `sortTasks` existe: no lee nada nuevo. |
| 8 | Minicalendario | Puntos de eventos del calendario y de días con hábitos; tocar lleva a `/calendario` | **Fuera del todo** | Calendario es fase 5+. Johan descartó también la versión con solo los días de hábitos. |
| 9 | `DaySigil` | Rueda de categorías con lo hecho hoy | **Dentro** | Ya portado y recibe los hábitos ya cargados: costo cero. Va al final en el teléfono. |
| 10 | Resumen del día (`marginalia`) | XP hoy, hábitos hechos, minutos de foco | **Dentro** | Mismos datos que la cabecera. |

En el teléfono queda una columna: `XPBar`, Hábitos de hoy (`rubric`, la única), Pomodoro, Tareas
prioritarias, `DaySigil` y el resumen; en `lg:`, las columnas de la v1 sin las tarjetas que salen.

---

## Decisiones

Tomadas por Johan el 2026-11-15.

- **A. El resumen del día sale de `GET /diary/{hoy}` (A1).** Ya existe, cuesta 2 ms y hoy cae en la
  caché de 7 días; si algún día la entrada pesa en el Inicio, se pasa a una ruta propia (A2) y se
  anota.
- **B. Sin conexión: caché de disco con la cola encima, sin XP optimista (B1), y un aviso global
  pequeño.** «sin conexión · N pendientes», o solo «N pendientes» si hay red y la cola no ha subido.
  El XP no se adelanta porque el multiplicador y los logros los decide el servidor. El aviso es el
  único componente nuevo del cromo y se justifica en su commit.
- **C. Un token por dispositivo (C2): teléfono, tablet y PC, comparados en el worker sin D1, cada
  uno revocable sin tocar los otros.** Perder el teléfono no obliga a cambiar el token de los demás.
- **La v2 corre en el PC antes del cambio:** el worker sirve la web (`assets` en `wrangler.toml`) en
  el mismo origen que la API. El ROADMAP no cambia.
- **D. Inicio en `/`, y la app arranca ahí (D1).** Como la v1; `BottomNav` ya lo pone primero.
- **E. Sin `PATCH /user` hasta Ajustes (E1).** El nombre se migra, renombrar es raro y la ruta del
  vault ya no tiene uso (fila 41).

### Opciones que se descartaron

Quedan como historia.

- **A2**, ruta propia para el resumen: una ruta y una caché más para ahorrar poco. **A3**, `xp_today`
  dentro de `GET /user`: cargaba más la lectura más cara del Inicio (8,5 ms, con picos sin explicar).
- **B2**, XP optimista sumando el `xp_reward` de lo que está en cola: la barra podría retroceder al
  sincronizar. Aviso solo por vista: no dice cuánto falta por subir.
- **C1**, token único y procedimiento escrito: perder un dispositivo obligaba a rotar todos. **C3**,
  Cloudflare Access delante de la web del PC: sin comprobar en el plan gratis ni con Capacitor.
- **D2** (arrancar en la última vista) y **D3** (arrancar en Hábitos en el teléfono).
- **E2**, renombrar dentro del mínimo.

---

## Diferencias con la v1

Se pasan a «Diferencias permitidas» de `caracterizacion-v1.md` en la 2.5.1.

| # | Diferencia | v1 | v2 | Motivo |
|---|---|---|---|---|
| 44 | Refresco de `GET /user` | Cada 30 s, y `POST /user/evaluate-streaks` al abrir | Al volver a la app y tras cada lote de escrituras; `GET /user` asienta (ADR 0005) | Ya es así desde la 2.1.5; la tabla no lo tenía. Sondear cada 30 s gasta requests y CPU sin que nada cambie. |
| 45 | Misiones en el Inicio | `QuestsCard` | No está | Misiones es fase 5+. |
| 46 | Check-in en el Inicio | `EnergyCheckin` | No está | Check-ins es fase 5+, como la fila 36. |
| 47 | Minicalendario del Inicio | Eventos y días con hábitos; lleva al calendario | No está | Calendario es fase 5+. |
| 48 | Aviso sin conexión | Franja global bajo `TopBar`: «Sin conexión con el servidor — reintentando…» | Aviso global pequeño: «sin conexión · N pendientes», o «N pendientes» con red y la cola sin subir | La v2 funciona sin conexión: el aviso dice cuánto falta por subir, no que la app no sirve. |
| 49 | Acceso | Sin autenticación (`127.0.0.1`) | Un bearer por dispositivo (teléfono, tablet, PC) en toda ruta de la API salvo `/health`, comparado en el worker sin D1 y revocable uno a uno; un 401 pide el token de nuevo | Invariante 6 de `AGENTS.md`; decisión C. |
| 50 | `PATCH /user` | Renombra y guarda `obsidian_vault_path` | No existe | Decisión E. La ruta del vault no tiene uso (fila 41). |

El XP del día en el Inicio sigue la fila 43; no hace falta fila nueva.

---

## Alcance: la v1 frente a la v2

| v1 | v2 | Nota |
|---|---|---|
| `GET /user` | ya existe | Con eventos de vidas (2.1.4). |
| `PATCH /user` | no | Fila 50. |
| `POST /user/evaluate-streaks` | no | Lo hace `GET /user` (fila 44). |
| `GET /diary/{date}/summary` | `GET /diary/{hoy}` | Decisión A. |
| `GET /quests`, `/checkins`, `/calendar`, `/stats` del Inicio | no | Filas 45 a 47. |
| `Dashboard.tsx` | `pages/Home.tsx` (nombre a confirmar) | Componentes ya portados; el único nuevo es el aviso global. |
| Franja sin conexión de `App.tsx` | aviso global pequeño | Fila 48. |
| Sin autenticación, solo escritorio | token por dispositivo; web servida por el worker | Fila 49. |

Fuera de alcance: Ajustes completo, vista de logros, misiones, check-ins, calendario, estadísticas.

---

## 2.5.1 — Caracterización de la v1

- **`_enrich`**: escenario `usuario_niveles` en `golden/user/` con XP 0, uno antes y justo en el umbral
  de los niveles, un nivel alto y XP en 0 tras una penalización, con los cuatro campos de progreso
  (`xp_for_current_level`, `xp_for_next_level`, `xp_into_level`, `xp_span`).
- Lista de los goldens que ya graban esos campos sin que nadie los compare.
- **El resumen del día** ya está caracterizado (`diary/resumen_dia`); no se graba de nuevo.
- **Lo del Inicio que vive en el cliente de la v1** (no hay golden de backend): bono de racha, las 4
  tareas de `sort=priority` y los grupos por categoría, cada caso con su línea de `Dashboard.tsx`, en
  `caracterizacion-v1.md`, para los tests de la 2.5.3.

Terminado: goldens commiteados y filas 44 a 50 en `caracterizacion-v1.md`.

## 2.5.2 — Dominio y API

- El nivel de `respond` pasa a `domain` (función pura `level_progress(xp)`) y `tests/golden_user.rs`
  compara los cuatro campos contra `usuario_niveles` y contra los goldens que ya los graban.
- **Tokens por dispositivo (decisión C):** el worker acepta un token por dispositivo (teléfono,
  tablet, PC), guardados como secretos de wrangler y comparados en tiempo constante, sin D1. Sin
  token, con uno desconocido o con uno revocado: 401. Tests del worker: cada token entra, uno quitado
  ya no, `/health` sigue abierto. El formato exacto de los secretos se decide aquí y se anota.

Terminado: goldens de usuario en verde y `cargo test -p grimoire-worker` con los tokens.

## 2.5.3 — Capa de datos del Inicio

- Hook que junta usuario, hábitos con la cola encima, tareas prioritarias, pomodoro y el resumen de
  `GET /diary/{hoy}`. Los componentes reciben props (`AGENTS.md`, interfaz 4).
- El conteo de pendientes para el aviso de la decisión B, desde la cola.
- Tests, como `queue.test.ts`:
  - Marcar un hábito sin conexión desde el Inicio: aparece marcado en el Inicio y en Hábitos, y sale
    un solo `POST`.
  - Bono de racha, las 4 prioritarias y los grupos, con los casos de la 2.5.1.
  - Arranque sin señal con caché: el Inicio se pinta con lo de disco; el XP no se adelanta.
  - El aviso: sin red, «sin conexión · N pendientes»; con red y cola sin subir, «N pendientes»; con
    todo arriba, nada.
- Comprobar con mutaciones que los tests no pasan en vacío.

Terminado: `npm run typecheck && npm test && npm run build` en verde.

## 2.5.4 — Medición

- CPU en producción de abrir el Inicio con datos de tamaño real (como en la 0.3: seed sintético, nada
  real), con `cpuTime` de `wrangler tail` y una request por segundo: `GET /user`, `GET /habits`,
  `GET /tasks`, `GET /pomodoro/today` y `GET /diary/{hoy}`. Filas leídas por apertura y cuántas
  aperturas caben en las 5 M filas diarias.
- Asentar en `GET /user` es la única escritura concurrente del Inicio (teléfono y tablet al abrir a la
  vez); ya está cubierta por los tests de `user.rs`. No se mide de nuevo.

Terminado: tabla en «Hallazgos», y si algo pasa de 10 ms de mediana, se para y se decide antes de la
vista.

## 2.5.5 — Vista Inicio

- `/` deja de ser `Pendiente` y es la vista de arranque (decisión D). Mobile-first, la `rubric`
  primero; en `lg:`, las columnas de la v1 sin las tarjetas 5, 6 y 8.
- El aviso global de la decisión B, en el cromo, en todas las vistas. Es el único componente nuevo; su
  commit lo justifica (`AGENTS.md`, interfaz 1).

Terminado: capturas a 393 × 852 y 1280 × 800 del Inicio con datos, sin conexión con pendientes y sin
caché, revisadas con las reglas de `DESIGN_SYSTEM.md` (una sola `rubric`, oro solo en recompensa,
44 px táctiles, nada cortado).

## 2.5.6 — Web en el PC y tokens por dispositivo

- **Servir la web desde el worker:** `assets` en `wrangler.toml` con `app/dist`, en el mismo origen
  que la API. **Sin comprobar, se verifica contra la versión fijada de wrangler antes de usarlo:**
  - Las rutas de la app y las de la API no deben pisarse. Hoy son distintas por idioma (`/habitos`
    frente a `/habits`), salvo **`/pomodoro`**, que es ruta de la app y prefijo de la API
    (`/pomodoro/today`, `/pomodoro/sessions`). El respaldo de SPA (servir `index.html` en rutas sin
    archivo) no puede tragarse un `GET` de la API.
  - Los archivos estáticos no pasan por el bearer (son el código público del repo); la API sí.
- **`CORS_ORIGIN`:** la web en el mismo origen no hace peticiones de origen cruzado, así que no
  necesita CORS. `CORS_ORIGIN` sigue siendo solo `https://localhost`, para la APK. Dos cosas a vigilar:
  `API_URL` en `client.ts` es absoluta (`https://grimoire.jbustosbriceno.workers.dev`); si la web se
  sirve un día desde otro dominio, pasa a ser de origen cruzado y hay que usar una URL relativa o
  agregar ese origen. Y Vite en `localhost:5173` sigue necesitando `CORS_ORIGIN` en el `--env-file`
  de `wrangler dev`, como hasta ahora.
- **`TokenGate` con un token por dispositivo:** cada dispositivo guarda el suyo (Keystore en la APK,
  `localStorage` en el navegador del PC). Cómo se pone: el formulario de hoy. Cómo se rota: se cambia
  el secreto de ese dispositivo, el dispositivo recibe 401, pide el token nuevo y su cola espera sin
  perderse. Lo que cambia es el secreto en el worker; el cliente no necesita saber qué dispositivo es.
- **Procedimiento del día del cambio** en `ROADMAP.md` (fase 4): colas vacías en los tres
  dispositivos, vaciar la base, rotar los tres tokens, escribir cada uno en su dispositivo y comprobar
  que nada quedó en cola. Una cola con escrituras de antes de vaciar la base no puede llegar a la
  base nueva.

Terminado:
- En local (`wrangler dev` con assets): `GET /` sirve la app, `GET /habitos` y `GET /pomodoro` sirven
  la app al navegar, y `GET /habits`, `GET /pomodoro/today` y `GET /user` sin bearer dan **401** y con
  bearer, JSON.
- Rotar un token con una escritura en cola deja la cola pausada, y el token nuevo la reanuda sin
  duplicar; los otros dos dispositivos siguen entrando.

## 2.5.7 — Prueba en el teléfono, la tablet y el PC

Johan, contra producción (el deploy y los secretos los hace o los autoriza él):

- Abrir el Inicio con y sin señal; marcar un hábito y completar una tarea desde ahí, y ver el XP subir
  en la barra al sincronizar. El aviso de pendientes aparece y se va.
- Teléfono, tablet y PC abiertos a la vez sobre el mismo día: una sola concesión por marca, vidas
  cobradas una vez.
- Subir de nivel: `LevelUpOverlay` una vez.
- Revocar el token de un dispositivo: ese pide token, los otros dos siguen.
- En la tablet (Android 16, ya tiene la APK), dos pendientes de módulos anteriores: el aviso
  `notificationAccess` de Tareas en Android 14+ (2.2.6) y la vista de Hábitos a 1280 × 800 (2.1.5).
- En el PC: el conflicto del Diario con un PC real (en la 2.4.6 se simuló desde el WebView) y la rama
  web de los recordatorios de Tareas (2.2.6).

Terminado: **se consulta D1 antes de darlo por bueno**: `users.xp` = suma de `xp_log`, una concesión
por marca, y el XP de hoy del Inicio igual a la suma de `xp_log` del día.

---

## Lo que queda de la fase 2 antes de la fase 3

Recogido de «Hallazgos» de los cuatro módulos el 2026-11-15 y revisado de nuevo el mismo día. Un punto
es «abierto» porque se buscó su cierre en los cuatro documentos, en `fase-0.md` y en `ROADMAP.md`, y
no apareció.

**Van a la 2.5.7**

1. **Tareas, 2.2.6:** el aviso `notificationAccess` en Android 14+ nunca se vio en pantalla (el
   teléfono es API 33). Se prueba en la tablet.
2. **Hábitos, 2.1.5:** la vista a 1280 × 800 solo se vio en navegador. Se prueba en la tablet.
3. **Tareas, 2.2.6:** la rama web de los recordatorios no se probó en un navegador real. Se prueba en
   el PC.
4. **Diario, 2.4.6:** el conflicto entre dispositivos se probó con el «PC» simulado desde el WebView.
   Se repite con el PC real.

**Abiertos**

5. **Hábitos, 2.1.2:** la penalización de XP no se ejercitó en producción; su `INSERT` solo lo cubren
   los tests contra SQLite. Ningún hallazgo posterior la vio en D1 remota.
6. **Pomodoro, 2.3.7:** una sesión que cruza la medianoche cuenta para el día de su `finished_at`, pero
   la recta de la jornada la dibuja por su `started_at`. Anotado como «borde, sin arreglar».
7. **Pomodoro, 2.3.7:** el «25 → 1 que quedó en 25» de la configuración no se reprodujo; el arreglo
   cubrió el «1 → 3».
8. **CPU:** los picos de 13–51 ms (fase 0, 2.1.2, 2.1.4) siguen sin explicar (hipótesis: arranque en
   frío). `ROADMAP.md` ya dice vigilar los 1102 el primer mes.
9. **Hábitos, 2.1.3**, de baja prioridad: el origen de las 6 marcas de hoy en los hábitos `Bench` y el
   7403 de la `0003` («parece transitorio; no se investigó más»; la `0006` y la `0007` se aplicaron al
   primer intento).
10. **Pomodoro, 2.3.6:** el retraso de 45,8 s del foco encadenado tras el descanso largo (paso 3b)
    «sigue sin explicar». Es el único de más de 1 s.

**Cerrados con un límite aceptado** (no se reabren salvo que reaparezca el problema)

- **Tareas, 2.2.5:** la prueba en el teléfono contra producción está hecha (2026-10-31, D1 revisada,
  `users.xp` = 969 = suma de `xp_log`). Límite: la checklist y mover no dejan rastro en D1, y esos dos
  pasos quedan con el reporte de Johan. Esto cierra también el «sin probar contra producción» de la
  2.2.4. *El borrador anterior de este plan lo daba por abierto: fue un error de lectura.*
- **Hábitos, 2.1.6:** la marca tardía se simuló con 32 s de reloj atrasado, no una noche real, y la
  transición 2 → 3 de las vidas no se observó en orden. Johan cerró el módulo con ese límite.
- **Pomodoro, 2.3.1:** la serie B se cerró por decisión de Johan sin medición cuantitativa, con la
  condición de reabrirla si el retraso reaparecía en la 2.3.6. Ahí los retrasos fueron de 0,05 a
  0,6 s, salvo uno (punto 10), que no pasa de 60 s y por eso no la reabre.

**Deuda anotada**

- **Diario:** `ponytail:` sin fusionar `PUT` pendientes en la cola.
- **`ROADMAP.md`:** react-router 6 → 7 (`npm audit`), `manualChunks` (bloque de más de 500 kB), la
  ventana de historial por duplicación y vigilar los 1102.
- **Datos de prueba en producción** (tareas «Prueba rec A/B», sesiones de 1 min, la entrada del
  14-nov): se van al vaciar la base en la fase 4; no se borran antes sin preguntarle a Johan.

---

## Hallazgos

(vacío)
