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
  - Bono de racha, las 4 prioritarias y los grupos, con los casos de la 2.5.1. En las prioritarias,
    los empates siguen el orden del tablero (`rank`), no el de creación de la v1 (fila 51).
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
- **Orden para pasar a los tokens por dispositivo sin cortar producción** (la 2.5.2 deja al worker
  aceptando `GRIMOIRE_TOKEN` mientras exista): primero los tres secretos nuevos con
  `wrangler secret put`; después cada dispositivo con el suyo (el log dice `dispositivo=phone`,
  `tablet` o `pc`, y ya no `legacy`); al final, borrar `GRIMOIRE_TOKEN`.
- **Procedimiento del día del cambio** en `ROADMAP.md` (fase 4): colas vacías en los tres
  dispositivos, vaciar la base, rotar los tres tokens, escribir cada uno en su dispositivo, comprobar
  que nada quedó en cola y borrar `GRIMOIRE_TOKEN` si sigue existiendo. Una cola con escrituras de antes de vaciar la base no puede llegar a la
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

- **2.5.1, caracterización** (2026-11-15): `usuario_niveles`, 400 pasos, v1 en `f85381f`, grabado
  con bases temporales; los 28 goldens anteriores salieron idénticos al regenerar. Detalle en
  «Hallazgos» de `caracterizacion-v1.md`:
  - El nivel de la v1 es una columna, pero `award_xp` la recalcula del XP en cada escritura: en los
    goldens es función del XP. Para la migración, comprobar `level = xp_to_level(xp)` en la copia real.
  - 35 pasos en 19 goldens ya graban los cuatro campos de progreso sin que nadie los compare: la
    2.5.2 los empieza a comparar.
  - Los grupos por categoría del Inicio salen en orden alfabético (lo ordena `GET /habits`), no de
    creación. Los empates de prioridad pueden diferir de la v1 (`rank` frente a creación): se decide
    en la 2.5.3. **Decidido por Johan el 2026-11-15: orden del tablero, fila 51.**
- **2.5.2, dominio y API** (2026-11-15):
  - **Golden de niveles completado** (revisión de Hermes sobre `98f4f60`): `usuario_niveles` llega
    ahora a 22 499/22 500 (nivel 15, «Arconte de la Voluntad»), 39 999/40 000 (20, «Ente del Éter
    Puro») y 44 099/44 100 (21, conserva el del 20); 965 pasos, 586 KB. Se regeneraron los 29
    escenarios completos y los 28 anteriores salieron idénticos. Una primera regeneración con la
    salida cortada por `head` no valía (Python pudo morir por la tubería tras el segundo escenario y
    los demás no se habrían reescrito); se repitió entera.
  - **`xp::level_progress`** en `domain`: nivel, título y los cuatro campos de progreso. `respond`
    la usa y el worker ya no calcula niveles. `tests/golden_user.rs` la compara en los 56 pasos que
    los graban (21 de `usuario_niveles` y 35 de los 19 goldens de la lista), y falla si cambia ese
    conteo. Todos coinciden con la v1.
  - **Formato de los secretos: uno por dispositivo con nombre fijo**, `GRIMOIRE_TOKEN_PHONE`,
    `_TABLET` y `_PC` (`worker/src/auth.rs`, `DEVICES`). Cada uno se rota o se borra con
    `wrangler secret` sin tocar los otros. Costo: un cuarto dispositivo pide una línea de código y
    un deploy. Se descartó un solo secreto con una lista: rotar uno obligaba a reescribirlos todos y
    un error de formato dejaba fuera a los tres.
  - **Comparación:** SHA-256 de cada lado (largo fijo) y `subtle` contra **todos** los secretos que
    existen, eligiendo el primero que coincide con `conditional_select`, sin salida temprana. Un
    secreto vacío o que no existe se salta y nunca autoriza; antes, `GRIMOIRE_TOKEN` ausente daba
    500 y ahora es un secreto más que falta. Dependencia nueva: `sha2` 0.10 (sin `std`); compila a
    `wasm32-unknown-unknown`.
  - **`GRIMOIRE_TOKEN` se sigue aceptando mientras exista** (dispositivo `legacy`), para que el
    deploy de esta tarea no deje fuera al teléfono ni a la tablet. Su borrado está en `ROADMAP.md`
    (fase 4) y el orden de la transición en la 2.5.6. `AGENTS.md` (invariante 6) ya nombra los tres.
  - **Log:** `dispositivo=phone`, `tablet`, `pc` o `legacy` en cada request autorizada; nunca el token.
  - **En local** (`wrangler dev` con tokens desechables en un `--env-file`, `_TABLET` vacío): cada
    token da 200 en `GET /user` y deja su `dispositivo=` en el log; bearer vacío, sin cabecera o
    desconocido, 401; `/health`, 200. Ningún valor de token aparece en el log. Un error de `grep`
    (un token desechable empezaba por `-`) imprimió parte de uno en la consola del agente; era de esta
    prueba y se borró con el archivo. Al cerrar, ningún `wrangler` ni `workerd` vivo y el 8787 libre.
  - **Mutaciones** (cada una con la suite del crate; el archivo se restaura después):

    | Mutación | Tests que caen |
    |---|---|
    | Nivel 1 con `xp_for_current_level` 100 | `level_progress_matches_every_recorded_user` |
    | El 15 con el título del 12 (el arreglo es de largo fijo; quitar la entrada no compila) | `level_progress_matches_every_recorded_user` |
    | Salir en el primer token que coincide | `every_present_secret_is_compared_whatever_matches` |
    | Aceptar un secreto vacío | `an_empty_secret_authorizes_nothing`, `every_present_secret_is_compared_whatever_matches` |
    | `GRIMOIRE_TOKEN` con otro nombre | `the_secret_names_are_the_documented_ones` |
    | Saltarse `GRIMOIRE_TOKEN` al comparar | `the_old_token_enters_while_it_exists`, `a_match_is_not_cut_short_by_order`, `every_present_secret_is_compared_whatever_matches` |

    Dos habrían sobrevivido con la primera versión: la salida temprana devuelve el mismo resultado
    (por eso `compare_all` cuenta las comparaciones y el test exige todas), y una guarda redundante
    de bearer vacío tapaba la del secreto vacío (se quitó; queda una sola regla). El cambio de nombre
    de `GRIMOIRE_TOKEN` no lo veía ningún test, porque pasan los secretos por posición: de ahí
    `the_secret_names_are_the_documented_ones`.
  - Verificación: `fmt`, `clippy -D warnings`, 139 tests de Rust y `cargo check` a wasm32 en verde.
- **2.5.3, capa de datos del Inicio** (2026-11-15):
  - `app/src/api/home.ts`: `useHome()` junta `useUser`, `useHabits(false)`, `useTasks`,
    `usePomodoroToday` y `useDiaryDay(hoy)`; no lee nada nuevo. Funciones puras con su test:
    `dayCount`, `streakBonus`, `groupByCategory`, `priorityTasks`, `syncNotice` y `msToMidnight`.
  - **Regla 1, qué se adelanta:** hábitos, tareas y minutos de foco llevan la cola encima; el XP
    (`user` y `xpToday`) es el del servidor hasta sincronizar. Un mismo test fija los dos lados: un
    hábito marcado sin conexión sube «X de N» en el Inicio y en Hábitos, y deja `xp`, `xp_into_level`
    y «XP hoy» como estaban.
  - **Regla 2, la racha del bono: la del servidor.** Es la que muestra Hábitos: los dos usan
    `useHabits(false)` (misma clave de caché) y `applyQueue` no adelanta la racha («racha, constancia
    y XP no se predicen»). Con una marca en cola que llevaría una racha de 6 a 7, el bono sigue en 1 y
    Hábitos sigue diciendo 6; al sincronizar, los dos cambian juntos.
  - **Minutos de foco: de `usePomodoroToday`, con las sesiones en cola**, no del resumen de
    `GET /diary/{hoy}`. Es lo mismo que muestra la vista Pomodoro y es algo que el dispositivo sabe
    (regla 1). El resumen del diario solo da el «XP hoy». **Matiz frente a la decisión A1**, que
    hablaba del resumen entero: no es una ruta nueva (`/pomodoro/today` ya está en disco), pero se
    anota para que Johan o Hermes lo confirmen.
  - **Regla 3, «hoy»:** `useToday()` agenda un temporizador hasta la próxima medianoche de Bogotá
    (UTC−5 fijo) y recalcula; la clave `['diary', 'day', hoy]` cambia sola aunque nada redibuje.
    `usePomodoroToday` y `useHabits` recalculan su día en el mismo render. `ponytail:` un
    temporizador suspendido en segundo plano se dispara al volver; si eso falla en algún Android, se
    agrega un recálculo en `visibilitychange`.
  - **Regla 4, el aviso:** `sync.ts` expone la red y el token por separado (`getLink` y
    `subscribeLink`, para `useSyncExternalStore`), sin cambiar `onlineManager`. Pendientes = estado
    `pending` (también lo que va en vuelo); las rechazadas (`error`) no cuentan. Sin red y sin
    pendientes, el aviso dice solo «sin conexión»; «1 pendiente» en singular.
  - **«X de N» cuenta todos los hábitos activos**, también los que no tocan hoy, como la v1
    (`Dashboard.tsx:121`).
  - **Tests con módulos frescos:** los de integración importan React, `react-dom` y React Query
    después de `vi.resetModules()`, en el mismo registro que `home.ts`; si no, los hooks serían de
    otra instancia de React.
  - **Mutaciones** (la suite completa de la app con cada una; el archivo se restaura después):

    | Mutación | Test que cae |
    |---|---|
    | «XP hoy» adelantado con la cola | `un hábito marcado sin conexión desde el Inicio…` |
    | XP de la barra adelantado con la cola | `un hábito marcado sin conexión desde el Inicio…` |
    | Racha del bono adelantada por la cola | `un hábito marcado sin conexión desde el Inicio…` |
    | Empates por creación (orden de `id`) | `empates de prioridad: el orden del tablero…` |
    | Clave de hoy fija (sin temporizador) | `«hoy» cambia a medianoche…` |
    | Rechazadas contadas como pendientes | `aviso: distingue sin red, cola sin subir…` |
    | «sin conexión» con un 401 | `aviso: distingue sin red, cola sin subir…` |

  - Verificación: `typecheck`, 219 tests y `build` en verde.
- **2.5.4, medición del Inicio** (2026-11-15, madrugada de Bogotá; con el «sí» de Johan):
  - **Entorno `bench`** (`[env.bench]` en `wrangler.toml`): worker `grimoire-bench`
    (`https://grimoire-bench.jbustosbriceno.workers.dev`, versión `7aba6c2d-4ae1-416b-bf09-3ca0fef65675`)
    y D1 `grimoire-bench`, **`database_id` `a2723736-bceb-47f4-9827-3c5c363c2443`**, distinto del de
    producción (`7295c42d-…`); las dos en la región ENAM. `--dry-run` enlaza `env.DB` a `grimoire-bench`
    con `--env bench` y a `grimoire` sin él. Migraciones `0001`–`0007` aplicadas. Producción no recibió
    ningún seed.
  - **Seed** (los cuatro `bench_seed*.py`, con `BENCH_HOY=2026-11-15`, variable nueva: sin ella cada
    script conserva su fecha original). Con las fechas viejas, las rachas de 400 días de la 0.3 estarían
    rotas desde el 10-28 y `GET /habits` saldría más barato que el peor caso.

    | Dato | Seed (peor caso) | Escala real de la v1 |
    |---|---|---|
    | Hábitos | 10, 9 383 marcas en 3 años, dos rachas intactas de 400 días hasta ayer | 15 hábitos, 70 marcas (2.1.3) |
    | Tareas (`pesado`) | 500 (300 abiertas, 200 hechas), 1 015 ítems, 20 proyectos | 95 (90 abiertas), 320 ítems, 10 proyectos (2.2) |
    | Pomodoro | 5 000 sesiones en 2 años (4 de hoy), 20 proyectos más | 22 sesiones (2.3) |
    | Diario | 1 000 entradas de 2 000 caracteres, también la de hoy | sin dato anotado |

  - **CPU** (`cpuTime` de `wrangler tail --env bench`, una request por segundo, token desechable
    `GRIMOIRE_TOKEN_PC`; todas `ok`, y las 125 autorizadas con `dispositivo=pc`):

    | Request | n | Mediana | Mín–máx | > 10 ms | Filas leídas |
    |---|---|---|---|---|---|
    | `GET /user`, apertura en frío (11 días por asentar) | 5 | 10 ms | 4–23 | 2 | 222 |
    | `GET /user` | 20 | 3 ms | 1–18 | 1 | 220 |
    | `GET /habits` | 20 | 6,5 ms | 3–14 | 4 | 2 959 |
    | `GET /tasks` | 20 | 8 ms | 5–28 | 8 | 1 746 |
    | `GET /pomodoro/today` | 20 | 1,5 ms | 1–4 | 0 | 8 |
    | `GET /diary/{hoy}` | 20 | 1,5 ms | 1–5 | 0 | **9 395** |
    | `GET /health` (sin auth) | 24 | 1 ms | 0–17 | 2 | 0 |
    | `GET /nada` (auth, 404, sin D1) | 20 | 0 ms | 0–6 | 0 | 0 |

    - Las aperturas en frío se prepararon con `UPDATE users SET settled_through = '2026-11-01'` en la D1
      de bench antes de cada una. Serie: 10, 15, 23, 4, 7.
    - **Ninguna mediana pasa de 10 ms.** La apertura en frío queda justo en 10 y `GET /tasks` es la que
      más se pasa (8 de 20), con 500 tareas frente a las 95 reales. Los picos (17–28 ms) salen al
      principio de cada tanda, como en la fase 0.
    - **Autenticación:** `GET /nada` (dos SHA-256 y cuatro secretos) no cuesta más que `/health`; la
      diferencia es ruido, por debajo de la resolución de 1 ms de `cpuTime`.
  - **Filas por apertura normal: 14 328** (220 + 2 959 + 1 746 + 8 + 9 395). Con los 5 M diarios de
    D1 caben unas **349 aperturas al día** con este seed.
  - **Hallazgo, sin optimizar (se pregunta antes de la 2.5.5): `GET /diary/{hoy}` recorre todas las
    marcas.** `HABITS_DONE` filtra `habit_logs` solo por `local_date`, y el único índice es
    `(habit_id, local_date)`. `EXPLAIN QUERY PLAN` en bench: `SCAN l`. Son 9 383 de las 9 395 filas
    de esa request. El CPU no lo nota (el recorrido es de D1), pero son dos tercios de las filas de
    cada apertura y crece con cada marca. Con la escala real (70 marcas) no pesa hoy. Un índice por
    `local_date` en una migración nueva lo dejaría en unas pocas filas.
  - **Producción tiene el seed de la 0.3:** `habit_logs` tiene 9 429 filas, frente a las 70 marcas de
    la v1. Es lo que decía Hermes: abrir el Inicio en producción hoy recorre esas marcas, y asentar
    cobra contra hábitos `Bench`. Se va al vaciar la base en la fase 4.
  - **Limpieza de bench:** se queda, sin datos. Tablas vaciadas (la migración deja el usuario, el
    catálogo de logros y las categorías); usuario en `xp` 0, 3 vidas y `settled_through` NULL. Token
    desechable borrado (`wrangler secret delete GRIMOIRE_TOKEN_PC --env bench`): `/user` da 401.
    Ningún `wrangler`, `workerd` ni `tail` vivo.
  - **Producción: deploy de la 2.5.2** (2026-11-15, con el «sí» de Johan). Worker `feebc627` →
    **`67327d0c-84aa-4bf9-8970-85b5d4d2369e`**, código de `a427748`. Sin migraciones, sin seed y sin
    secretos nuevos: el teléfono y la tablet siguen con `GRIMOIRE_TOKEN`.
    - **Línea base antes del deploy:** `users.xp` 1094 = suma de `xp_log` (75 filas, la última de las
      04:32:12Z), `settled_through` 2026-11-12.
    - **Humo sin token:** `/health` 200; `/user`, `/habits` y bearer vacío, 401.
    - **Humo con token**, desde el WebView del teléfono con su propio token (sin imprimirlo; solo
      `GET`): `/health` 200; `/user` 200 con 1094 XP, nivel 3 «Escriba Errante», `xp_for_current_level`
      900, `xp_for_next_level` 1600, `xp_into_level` 194 y `xp_span` 700; `/habits` 200 con 21 hábitos.
      `wrangler tail`: `dispositivo=legacy` en las 4 requests autorizadas, más un `OPTIONS` 204.
    - El deploy se hizo antes del humo con token: el teléfono no estaba conectado y Johan pidió
      seguir. El camino de `GRIMOIRE_TOKEN` ya estaba probado en local (2.5.2), y con una falla la app
      habría pedido el token sin perder su cola.
    - **D1 después:** igual a la línea base (1094 = suma, 75 filas, ninguna nueva). Ningún `POST`.
    - Al cerrar: ningún `wrangler`, `workerd`, `tail` ni `vite` vivo, sin `adb forward`.
- **Índice de `habit_logs` por día** (2026-11-15, decidido por Johan tras la 2.5.4): migración
  `0008_habit_logs_local_date` (`CREATE INDEX habit_logs_local_date ON habit_logs (local_date)`).
  - `day_summary_reads_marks_by_index` (`worker/src/diary.rs`) pide `EXPLAIN QUERY PLAN` de
    `HABITS_DONE` contra el esquema de las migraciones y exige el índice nuevo. Sin la `0008` cae con
    `SCAN l`, el mismo plan que dio bench.
  - En la D1 local: aplicada, y el plan pasa a `SEARCH l USING INDEX habit_logs_local_date
    (local_date=?)`.
  - **Aplicada en remoto** el 2026-11-15, con el «sí» de Johan. Producción: bookmark de time travel
    antes de migrar `0000005e-00000000-00005124-8c8a9fa807971d7d863564ecb98cf0ce`; la `0008` entró
    al primer intento y el plan de `HABITS_DONE` pasó a `SEARCH l USING INDEX habit_logs_local_date`.
    Datos sin cambios: `users.xp` 1094 = suma de `xp_log` (75 filas), 9 429 marcas; `/health` 200.
    Bench: aplicada, mismo plan. El worker no cambió (sigue `67327d0c`).
  - Verificación: `fmt`, `clippy -D warnings` y 140 tests de Rust en verde.
- **2.5.5, vista Inicio** (2026-11-15):
  - `pages/Home.tsx` porta `Dashboard.tsx` de la v1 sin Misiones, Energía/Ánimo ni el minicalendario
    (filas 45 a 47), con los componentes ya portados (`PageHeader`, `XPBar`, `Card`, `SectionBand`,
    `HabitRow`, `TaskCard`, `DaySigil`) y la esfera del pomodoro (`ClockedTimer`, ahora exportado de
    `pages/Pomodoro.tsx` en vez de duplicarlo). `/` deja de ser `Pendiente` y es donde arranca la app
    (decisión D).
  - **Componente nuevo, el único: `SyncNotice`** (`components/layout/`), el aviso global de la
    decisión B, bajo `TopBar` en todas las vistas. Es visual y sin datos; `syncNotice.tsx`
    (`SyncNoticeHost`) lee la cola y la red, para que un cambio en la cola redibuje el aviso y no
    `App`. Tinta tenue y no la franja roja de la v1: la v2 funciona sin conexión.
  - **Layout:** en el teléfono, una columna con la `rubric` (Hábitos de hoy) primero tras la barra:
    Pomodoro, Tareas prioritarias, sigilo y resumen. En `lg:`, **dos columnas** y no las tres de la
    v1: sin Misiones ni Energía, la del medio quedaba solo con el Pomodoro y un hueco (visto en la
    captura). Hábitos a la izquierda (1,4), Pomodoro, Tareas y sigilo a la derecha.
  - **Adaptación táctil:** el casillero de `HabitRow` (16 px) lleva `gr-tactil`: área de 44 × 44 px
    medida en el navegador, sin cambiar el dibujo.
  - **Lo que solo salió al mirar las capturas** (sin caché y sin conexión): la cabecera decía «Sin
    hábitos todavía», la barra «Cargando…» para siempre, Tareas «Nada pendiente. ✦» y el resumen tres
    ceros, todo como si fueran datos. Ahora: la cabecera dice «Sin conexión», cada tarjeta que espera
    datos lo dice como en Hábitos y Tareas (`habitsOffline`, `tasksOffline` en `useHome`), y la
    barra, la cifra de la `rubric` y el resumen no se muestran.
  - **Capturas** (`docs/capturas/fase-2.5.5-*`), contra `wrangler dev` con una D1 local aparte
    (`--persist-to`, borrada al terminar) y datos inventados: 6 hábitos en 4 categorías con rachas de
    0 a 23, 5 tareas, 2 sesiones de hoy; 1130 XP. Navegador táctil (`hasTouch`) a 393 × 852 y
    1280 × 800:
    - Con datos (`inicio-*`, `inicio-abajo-*`): «3 de 6 hábitos · 90 XP · 50 min de foco», nivel 3,
      230/700, bono ×1.20 (racha de 23), las 4 prioritarias en orden (alta con fecha, alta, media con
      fecha, media).
    - Sin conexión con un pendiente (`sin-conexion-pendiente-*`): tras marcar «Estiramientos», «4 de 6»
      y Físico 2/2, con el XP en 90 y la barra igual (regla 1), y el aviso «sin conexión · 1 pendiente».
    - Sin caché (`sin-cache-*`): contexto nuevo, API bloqueada y `navigator.onLine` falso; aviso «sin
      conexión» y cada tarjeta esperando la señal.
    - Revisado en cada una: una sola `rubric`, `scrollWidth` igual al ancho, oro solo en nivel, bono,
      XP y rachas, nada cortado, sin errores en consola.
  - `pomodoro-context.test.tsx` monta `App` sin `QueryClientProvider`: simula `pages/Home` y
    `syncNotice` como ya simulaba las demás vistas.
  - Verificación: `typecheck`, 219 tests y `build` en verde. Al cerrar, ningún `wrangler`, `workerd`
    ni `vite` vivo, y el 8787 y el 5173 libres.
- **2.5.6, web en el PC y tokens por dispositivo** (2026-11-15):
  - **Assets, verificado contra la versión fijada** (wrangler 4.156, el asset worker de su miniflare):
    `[assets]` con `app/dist` y `not_found_handling = "single-page-application"`, **sin
    `run_worker_first`** y sin binding. Un archivo que existe se sirve sin pasar por el worker. Sin
    archivo, `canFetch` solo aplica el respaldo de SPA si la petición trae `Sec-Fetch-Mode: navigate`
    (`assets_navigation_prefers_asset_serving`, activo desde `compatibility_date` 2025-04-01; la
    nuestra es 2026-10-29). Cualquier otra petición va al worker con `not_found_handling` en `none`.
    Así se resuelve `/pomodoro` sin listar rutas: navegar ahí da la app y `fetch('/pomodoro/today')`
    llega a la API. Si se escribe una ruta de la API en la barra del navegador, aparece la app, no
    JSON; no se filtra nada.
  - **`API_URL`:** en la APK sigue siendo la absoluta de `workers.dev` (CORS desde `https://localhost`).
    En la web es `''`, la URL relativa del mismo origen, así que no usa CORS, y en `wrangler dev` habla
    con la API local y no con producción. `VITE_API_URL` sigue mandando cuando está puesta, como en
    Vite sobre 5173. Para distinguir los dos casos se usa `Capacitor.isNativePlatform()`.
  - **`TokenGate` no cambió.** En el navegador, `SecureStorage` guarda en `localStorage`
    (`capacitor-storage_grimoire-token`, confirmado en su `web.js` y en el navegador). El worker no
    necesita saber qué dispositivo es cada uno: ya lo deduce del secreto (2.5.2).
  - **Pruebas en local** (`wrangler dev --env-file` con tres tokens desechables, sin `GRIMOIRE_TOKEN`,
    y una D1 aparte con `--persist-to`, borrada al terminar):
    - Navegación a `/`, `/habitos`, `/pomodoro` y `/diario/2026-11-15`: 200 `text/html`.
      `/favicon.svg` y un `.js` de `/assets/` sin bearer: 200.
    - `GET /habits`, `/pomodoro/today` (con y sin `Sec-Fetch-Mode: cors`) y `/user` sin bearer: 401
      JSON. Con cualquiera de los tres tokens: 200 JSON. Con un token desconocido: 401. `/health`: 200.
    - **Rotación con una escritura en cola**, en el navegador a 1280 × 800: entrar con el token del
      PC; cortar la red; marcar «Estiramientos» (aviso «sin conexión · 1 pendiente»); reiniciar
      `wrangler dev` con `GRIMOIRE_TOKEN_PC` cambiado. El token viejo del PC da 401, y los del
      teléfono y la tablet, 200. Al volver la red, **un solo** 401 sobre `/complete`: se borra el token,
      aparece el formulario y la cola queda `pending` sin reintentar. Una recarga en ese estado
      conserva la cola. Con el token nuevo se envía una vez, con respuesta 200, y la cola queda vacía.
    - D1 al final: 1 marca, 1 concesión, `SUM(xp_log.amount)` = 20 = `users.xp`. El log de
      `wrangler dev` muestra `dispositivo=pc`, `phone` y `tablet` y nunca `legacy`.
  - **Para el deploy:** `wrangler dev` y `wrangler deploy` suben `app/dist`, así que hay que correr
    `npm run build` en `app/` antes; si no, se publica la web vieja. Lo dice el comentario de
    `wrangler.toml` y `AGENTS.md`. El orden de los secretos y el borrado de `GRIMOIRE_TOKEN` siguen
    como arriba y les toca a la 2.5.7 o a Johan.
  - Verificación: `typecheck`, 219 tests y `build` en verde. Rust sin cambios. Al cerrar, ningún
    `wrangler` ni `workerd` vivo, y el 8787 libre.
