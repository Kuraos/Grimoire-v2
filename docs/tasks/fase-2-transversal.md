# Fase 2.5 — Lo transversal e Inicio mínimo

**Estado: borrador, pendiente de aprobación de Johan.**

Depende de: los cuatro módulos de la fase 2 (Hábitos, Tareas, Pomodoro, Diario), la cola sin conexión
(ADR 0008) y la caracterización de la v1 (`docs/tasks/caracterizacion-v1.md`).

Objetivo: el punto 5 del «Mínimo para dejar la v1» de `ROADMAP.md`: usuario (XP, nivel, título,
vidas), Inicio mínimo (lo de hoy), autenticación y modo sin conexión. Es lo último de la fase 2. Hoy
el XP y el nivel no se ven en ninguna pantalla (lo notó Johan en la 2.4.6).

Cada tarea es una sesión de agente. Al terminar: verificación de `AGENTS.md` en verde, un commit
por tarea (`fase-2: <tarea>`) y una línea en «Hallazgos» si apareció algo. Si una tarea revela que
una decisión no se sostiene, se para y se anota, en vez de rodearla.

---

## Inventario: lo que ya existe en la v2

Comprobado en el código el 2026-11-15 (`main` en `cb1bc66`), no supuesto.

| Pieza | Estado | Dónde | Qué falta |
|---|---|---|---|
| `GET /user` | **Hecho** | `api/crates/worker/src/user.rs` | Devuelve XP, nivel, título, vidas provisionales, `xp_into_level`, `xp_span` y los eventos de vidas; asienta los días pendientes (ADR 0005). CPU en producción (2.1.x, seed de la 0.3): mediana 8,5 ms, 7 de 20 sobre 10 ms. **El cálculo de nivel (`respond`, el `_enrich` de la v1) vive en el worker, fuera de `domain`**: los goldens de Hábitos graban `xp_into_level` y `xp_span`, pero `golden_habits.rs` solo compara `level` y `title`. |
| `PATCH /user` | **No existe** | — | La v1 renombra y guarda `obsidian_vault_path`. `TopBar` oculta el lápiz sin `onRename` (su `TODO`). |
| `useUser` | **Hecho** | `app/src/api/user.ts` | `['user']` va a disco (`PERSISTED_QUERIES` en `sync.ts`). Se refresca después de cada lote de escrituras (`invalidateQueries` en `queryClient.ts`) y al volver a la app (2.1.5); sin el sondeo de 30 s de la v1. |
| Vidas en `TopBar` | **Hecho** | `components/layout/TopBar.tsx` | Tres corazones en todos los tamaños. Nombre y título solo en `lg:`. **XP y nivel no se ven en ningún tamaño.** |
| `XPBar` | **A medias** | `components/ui/XPBar.tsx` | Portado y adaptado a props (`user` en vez de `useUser()`, su `TODO(fase-2)`). Ninguna vista lo usa (`rg` sin resultados fuera de su archivo). |
| `LevelUpOverlay` | **Hecho** | `App.tsx`, `context.tsx` | Montado; lo dispara `onSyncResults` con el ascenso más alto del lote. |
| Toasts y logros de `context.tsx` | **Hecho** | `context.tsx`, `api/user.ts` | Errores de API (sin repetir en 4 s), eventos de vidas (una vez, recordados en `localStorage`), «Sincronizado · …» y un toast por logro. No hay vista de logros (fase 5+); `NextAchievement` no se usa. |
| `TokenGate` y el token | **A medias** | `TokenGate.tsx`, `api/client.ts` | Pide el token una vez, lo guarda en el Keystore (`@aparajita/capacitor-secure-storage`; en web cae a `localStorage`, visto en `dist/esm/web.js`), y ante un 401 lo vuelve a pedir y pausa la cola sin perderla. Falta: cambiar el token sin esperar un 401 (Ajustes no existe: `abrirAjustes` está vacío en `App.tsx`) y cualquier noción de dispositivo: un solo `GRIMOIRE_TOKEN` para todos. |
| Cola y toast de sincronización | **Hecho** | `api/sync.ts`, `api/queryClient.ts`, ADR 0008 | Cola y caché en disco, en línea = red **y** token, toast con el resumen de lo que llegó tarde. **No hay aviso global de «sin conexión» ni de pendientes**: la v1 tenía una franja bajo `TopBar` («Sin conexión con el servidor — reintentando…»). Hoy cada vista lo dice a su modo (Hábitos, Tareas, búsqueda del Diario). |
| `GET /diary/{día}/summary` | **No existe como ruta** | `worker/src/diary.rs`, `day` | El resumen viene dentro de `GET /diary/{día}` (decisión 7 del Diario): un `batch` de 5 consultas (entrada, conflictos, hábitos del día, sesiones del día, `xp_log` de un día antes a uno después). CPU en producción: mediana 2 ms (2.4.6). |
| Ruta `/` | **No existe la vista** | `App.tsx` | Es `Pendiente` («se porta en una fase siguiente»). `BottomNav` y `Sidebar` ya la ponen primera, como «Inicio», y la app arranca ahí. |
| La v2 en el PC | **No existe** | `lib.rs`, `wrangler.toml` | El comentario de `lib.rs` dice que el worker sirve la web, pero `wrangler.toml` no tiene `assets` y `GET /` responde **401** (comprobado el 2026-11-15). `CORS_ORIGIN` es solo `https://localhost` (la APK). `ROADMAP.md` pide el mínimo «en el teléfono, la tablet y el PC». |
| Componentes del Inicio de la v1 | **Portados** | `components/` | `HabitRow`, `QuestsCard`, `EnergyCheckin` y `DaySigil` sin uso; `TaskCard`, `PomodoroTimer`, `MiniCalendar`, `SectionBand` y `Card` en uso. `streakMultiplier` está en `utils.ts`. `QuestsCard` tiene un `TODO`: las misiones llegarían por props. |

---

## Lo que hace el Inicio de la v1

`frontend/src/pages/Dashboard.tsx` (280 líneas). Al abrir pide `listHabits()`,
`listTasks("?completed=false&sort=priority")` (se queda con 4), `getCheckin(hoy)` y
`daySummary(hoy)` (`GET /diary/{día}/summary`); y aparte `listEvents` del mes y `stats("year")` para
las marcas del minicalendario. El contexto sondea `GET /user` cada 30 s y muestra la franja de sin
conexión. Lo que la vista hace con eso, tarjeta por tarjeta, con una **propuesta** que Johan decide:

| # | Tarjeta | Qué muestra en la v1 | Propuesta | Razón |
|---|---|---|---|---|
| 1 | Cabecera «Hoy» | «X de N hábitos · XP · min de foco» | **Dentro** | Sale de los mismos datos que 3 y 10. |
| 2 | `XPBar` | Nivel, título, bono de racha (`streakMultiplier` de la **mejor** racha entre los hábitos), «+XP hoy» y la barra al siguiente nivel | **Dentro** | Es lo que hoy no se ve en ningún lado. Ya portado. El «XP hoy» sigue la fila 43. |
| 3 | Hábitos de hoy (`rubric`) | Todos los hábitos activos agrupados por categoría (`SectionBand` + `HabitRow`), marcar y deshacer; tocar uno lleva a `/habitos` | **Dentro** | Es el bucle diario. `habitActions` y `applyQueue` ya existen; `GET /habits` ya está en disco. |
| 4 | Pomodoro | `PomodoroTimer` pequeño, empezar o pausar, botón a `/pomodoro` | **Dentro** | `pomodoro-context` ya existe; no lee nada nuevo. |
| 5 | Misiones (`QuestsCard`) | Misiones del día y reclamarlas | **Fuera** | Misiones es fase 5+; no hay API ni tablas en la v2. |
| 6 | Energía / Ánimo (`EnergyCheckin`) | Check-in del día, 5 XP | **Fuera** | Check-ins es fase 5+ (como la fila 36 en el Diario). Los datos se migran igual. |
| 7 | Tareas prioritarias | Las 4 primeras abiertas por prioridad, completar | **Dentro** | `useTasks` ya está en disco y `sortTasks` existe: no lee nada nuevo. |
| 8 | Minicalendario | Puntos de eventos del calendario (azul) y de días con hábitos (morado, de `stats("year")`); tocar lleva a `/calendario` | **Fuera** | Calendario es fase 5+ y el destino sería una vista `Pendiente`. Alternativa barata, si Johan la quiere: solo los puntos de hábitos, desde `GET /habits/heatmap` (ya en disco), sin enlace. |
| 9 | `DaySigil` | Rueda de categorías con lo hecho hoy | **Dentro** | Ya portado y recibe los hábitos ya cargados: costo cero. Va al final en el teléfono. |
| 10 | Resumen del día (`marginalia`) | XP hoy, hábitos hechos, minutos de foco | **Dentro** | Mismos datos que la cabecera. |

Con las propuestas, en el teléfono queda una columna: `XPBar`, Hábitos de hoy (`rubric`, la única),
Pomodoro, Tareas prioritarias, `DaySigil` y el resumen; en `lg:`, las columnas de la v1 sin las
tarjetas que salen.

---

## Decisiones abiertas

Ninguna está tomada. Cada una con sus opciones; Johan decide.

### A. De dónde sale el resumen del día (XP hoy y minutos de foco)

El Inicio es la vista que más se abre. Hoy, abrirlo con las propuestas pediría `GET /user`,
`GET /habits`, `GET /tasks` y `GET /pomodoro/today` (los cuatro ya en disco) más el resumen.

| Opción | Qué lee | A favor | En contra |
|---|---|---|---|
| A1. Reutilizar `GET /diary/{hoy}` | 5 consultas: entrada y conflictos (por índice), hábitos y sesiones del día, `xp_log` de 3 días (índice `xp_log_created`). 2 ms de mediana | Sin ruta nueva. Hoy ya cae en la caché de 7 días, así que abrir el Diario después es instantáneo | Trae la entrada (hasta 200 000 caracteres) y los hábitos del día, que el Inicio no usa o ya tiene |
| A2. Ruta propia (`GET /today` o similar) | Solo `xp_log` de 3 días y la suma de minutos: 2 consultas | Respuesta mínima | Una ruta y una caché más que mantener, para ahorrar poco |
| A3. Agregar `xp_today` a `GET /user`, y los minutos del cliente (`GET /pomodoro/today`, ya en disco) | Una consulta más dentro del `batch` de `GET /user` | Una request menos por apertura; el XP del día se refresca con el usuario | `GET /user` ya es la lectura más cara del Inicio (8,5 ms, picos sin explicar) y asienta días |

En las tres, el XP del día cuenta el día de la concesión (fila 43). **Sin medir:** el costo de abrir el
Inicio entero. Va en la 2.5.4.

### B. Qué ve el Inicio sin conexión

Todo lo que propone el Inicio ya está en la caché de disco salvo el resumen (con A1, también: hoy cae
en la ventana de 7 días si se abrió). Lo abierto es:

- **B1.** Caché de disco con la cola encima, como las demás vistas: hábitos y tareas se ven marcados;
  el XP, el nivel y el XP del día se quedan en lo último que dijo el servidor hasta sincronizar.
- **B2.** Como B1, más un XP optimista en la barra (sumar el `xp_reward` de lo que está en cola).
  Es aproximado: el multiplicador de racha y los logros los decide el servidor, así que la barra
  podría retroceder al sincronizar.
- **Aviso:** franja global como la de la v1 (sin conexión, y cuántas escrituras esperan) o el aviso
  por vista de hoy. La franja es un componente nuevo en el cromo, que hay que justificar (`AGENTS.md`).
- **Sin caché** (dispositivo nuevo o caché vencida, sin señal): las vistas de hoy muestran su aviso y
  nada más. Sin opción que tomar; se anota.

### C. Autenticación antes del cambio

Hoy: un solo `GRIMOIRE_TOKEN`, el mismo en el teléfono y la tablet, en el Keystore de cada APK. El
paso de la fase 4 es vaciar la base y **rotar el token**. Con `TokenGate`, cada dispositivo ve un 401,
pide el token nuevo y su cola espera. **Riesgo:** una cola con escrituras de antes de vaciar la base
se mandaría contra la base nueva. El procedimiento del día tiene que dejar las colas vacías antes de
rotar.

- **C1. Token único y procedimiento escrito.** Sin código: sincronizar todo, rotar, escribir el token
  nuevo en cada dispositivo. Perder el teléfono obliga a rotar para todos.
- **C2. Un token por dispositivo** (varios secretos o sus hashes, comparados en el worker, sin D1).
  Se revoca uno sin tocar los otros. Algo de código en el worker y en `TokenGate`.
- **C3. Cloudflare Access delante de la web del PC**, con el bearer de siempre en la APK. **Sin
  comprobar:** que el plan gratis lo cubra y cómo convive con el WebView de Capacitor.

Y una pregunta que no es de autenticación pero la condiciona: **¿la v2 tiene que correr en el PC antes
del cambio?** `ROADMAP.md` dice que sí, y hoy no corre (inventario). Servir la web desde el worker
(`assets` en `wrangler.toml`) la hace del mismo origen y le basta el bearer; en el navegador el token
quedaría en `localStorage`. Si el PC queda para después del cambio, hay que corregir el ROADMAP.

### D. ¿`/` deja de ser `Pendiente` y es la vista de arranque en el teléfono?

- **D1.** Sí: Inicio en `/` y la app arranca ahí, como la v1. `BottomNav` ya lo pone primero.
- **D2.** Inicio en `/`, pero la app arranca en la última vista usada.
- **D3.** Inicio en `/`, y el teléfono arranca en Hábitos: el uso real del teléfono es «registrar
  rápido» (`DESIGN_SYSTEM.md`) y Hábitos es lo que más se marca.

Con caché de disco las tres pintan al instante; sin caché, el Inicio es la vista que más espera
(cinco lecturas frente a una).

### E. ¿Renombrar entra en el mínimo?

`PATCH /user` no existe. En la v1 hace dos cosas: renombrar y guardar `obsidian_vault_path`. La ruta
del vault ya no tiene uso (fila 41: el diario no se exporta). Renombrar es raro: el nombre se migra.

- **E1.** Fuera hasta la fase 5+, con Ajustes.
- **E2.** Dentro, solo el nombre: una ruta, el lápiz de `TopBar` y su test.

---

## Diferencias con la v1

Propuestas. Se agregan a «Diferencias permitidas» de `caracterizacion-v1.md` al aprobar el plan, con
lo que Johan decida en A–E.

| # | Diferencia | v1 | v2 | Motivo |
|---|---|---|---|---|
| 44 | Refresco de `GET /user` | Cada 30 s, y `POST /user/evaluate-streaks` al abrir | Al volver a la app y tras cada lote de escrituras; `GET /user` asienta (ADR 0005) | Ya es así desde la 2.1.5; la tabla no lo tenía. Sondear cada 30 s gasta requests y CPU sin que nada cambie. |
| 45 | Misiones en el Inicio | `QuestsCard` | No está | Misiones es fase 5+ (propuesta 5). |
| 46 | Check-in en el Inicio | `EnergyCheckin` | No está | Check-ins es fase 5+ (propuesta 6, como la fila 36). |
| 47 | Minicalendario del Inicio | Eventos y días con hábitos; lleva al calendario | No está, o solo días con hábitos y sin enlace | Calendario es fase 5+ (propuesta 8). |
| 48 | Aviso sin conexión | Franja global bajo `TopBar` | Según la decisión B | La v2 sí funciona sin conexión: el aviso dice otra cosa. |
| 49 | Acceso | Sin autenticación (`127.0.0.1`) | Bearer en toda ruta salvo `/health`; un 401 pide el token de nuevo | Invariante 6 de `AGENTS.md`. Forma según la decisión C. |
| 50 | `PATCH /user` | Renombra y guarda `obsidian_vault_path` | No existe, o solo el nombre | Decisión E. La ruta del vault no tiene uso (fila 41). |

El XP del día en el Inicio sigue la fila 43; no hace falta fila nueva.

---

## Alcance: la v1 frente a la v2

| v1 | v2 | Nota |
|---|---|---|
| `GET /user` | ya existe | Con eventos de vidas (2.1.4). |
| `PATCH /user` | según E | Fila 50. |
| `POST /user/evaluate-streaks` | no | Lo hace `GET /user` (fila 44). |
| `GET /diary/{date}/summary` | según A | |
| `GET /quests`, `/checkins`, `/calendar`, `/stats` del Inicio | no | Filas 45 a 47. |
| `Dashboard.tsx` | `pages/Home.tsx` (nombre a confirmar) | Componentes ya portados; ninguno nuevo salvo la franja de B. |
| Franja sin conexión de `App.tsx` | según B | Fila 48. |

Fuera de alcance: Ajustes completo, vista de logros, misiones, check-ins, calendario, estadísticas.

---

## 2.5.1 — Caracterización de la v1

- **`_enrich`**: `golden_habits.rs` y los demás comparan `level` y `title`, pero no
  `xp_for_current_level`, `xp_for_next_level`, `xp_into_level` ni `xp_span`, que los goldens ya
  graban. Escenario nuevo `usuario_niveles` en `golden/user/`: XP 0, justo en el umbral de cada nivel,
  uno antes, nivel alto, y XP en 0 tras una penalización.
- **El resumen del día** ya está caracterizado (`diary/resumen_dia`); no se graba de nuevo.
- **Lo del Inicio que vive en el cliente de la v1** (no hay golden de backend): el bono de racha es
  `streakMultiplier` de la mejor racha; las 4 tareas de `sort=priority`; los grupos por categoría en
  orden de aparición. Se anotan como casos con su línea de `Dashboard.tsx`, para los tests de la 2.5.3.
- Con E2: `PATCH /user` con nombre vacío, con espacios y válido.

Terminado: goldens commiteados y filas 44 a 50 (ajustadas a A–E) en `caracterizacion-v1.md`.

## 2.5.2 — Dominio y API

- El nivel de `respond` pasa a `domain` (función pura `level_progress(xp)`) y `tests/golden_user.rs`
  compara los cuatro campos contra los goldens de la 2.5.1 y los de Hábitos.
- Lo que decidan A (resumen) y E (renombrar), con tests contra SQLite si escribe.
- Con C2: comparación de tokens en el worker, con test de un token revocado.

Terminado: goldens de usuario en verde y `cargo test -p grimoire-worker` con lo nuevo.

## 2.5.3 — Capa de datos del Inicio

- Hook que junta usuario, hábitos con la cola encima, tareas prioritarias, pomodoro y el resumen. Los
  componentes reciben props (`AGENTS.md`, interfaz 4).
- Tests, como `queue.test.ts`:
  - Marcar un hábito sin conexión desde el Inicio: aparece marcado en el Inicio y en Hábitos, y sale
    un solo `POST`.
  - Bono de racha y las 4 prioritarias, con los casos de la 2.5.1.
  - Arranque sin señal con caché: el Inicio se pinta con lo de disco (decisión B).
- Comprobar con mutaciones que los tests no pasan en vacío.

Terminado: `npm run typecheck && npm test && npm run build` en verde.

## 2.5.4 — Medición

- CPU en producción de abrir el Inicio con datos de tamaño real (como en la 0.3: seed sintético, nada
  real), con `cpuTime` de `wrangler tail` y una request por segundo: cada request del Inicio y la
  opción de A elegida. Filas leídas por apertura y cuántas aperturas caben en las 5 M filas diarias.
- Asentar en `GET /user` es la única escritura concurrente del Inicio (teléfono y tablet al abrir a la
  vez); ya está cubierta por los tests de `user.rs`. No se mide de nuevo salvo que A3 la cambie.

Terminado: tabla en «Hallazgos», y si algo pasa de 10 ms de mediana, se para y se decide antes de la
vista.

## 2.5.5 — Vista Inicio

- `/` deja de ser `Pendiente` según D. Mobile-first, la `rubric` primero; en `lg:`, las columnas de la
  v1. Sin componentes nuevos salvo el que salga de B.
- Aviso sin conexión según B; renombrar según E.

Terminado: capturas a 393 × 852 y 1280 × 800, revisadas con las reglas de `DESIGN_SYSTEM.md` (una
sola `rubric`, oro solo en recompensa, 44 px táctiles, nada cortado).

## 2.5.6 — Autenticación

Según C. Como mínimo, el procedimiento del día del cambio escrito en `ROADMAP.md`: colas vacías en
todos los dispositivos, rotar `GRIMOIRE_TOKEN`, escribir el token nuevo y comprobar que nada quedó en
cola. Si se decide que la v2 corre en el PC antes del cambio, aquí va servir la web desde el worker.

Terminado: el procedimiento ensayado en local (`wrangler dev`, token desechable): rotar con una
escritura en cola deja la cola pausada y el token nuevo la reanuda sin duplicar.

## 2.5.7 — Prueba en el teléfono y la tablet

Johan, contra producción (el deploy lo hace o lo autoriza él):

- Abrir el Inicio con y sin señal; marcar un hábito y completar una tarea desde ahí, y ver el XP subir
  en la barra al sincronizar.
- Teléfono y tablet abiertos a la vez sobre el mismo día: una sola concesión por marca, vidas cobradas
  una vez.
- Subir de nivel: `LevelUpOverlay` una vez.

Terminado: **se consulta D1 antes de darlo por bueno**: `users.xp` = suma de `xp_log`, una concesión
por marca, y el XP de hoy del Inicio igual a la suma de `xp_log` del día.

---

## Lo que queda de la fase 2 antes de la fase 3

Recogido de «Hallazgos» de los cuatro módulos el 2026-11-15. «Abierto» quiere decir que no encontré
dónde se cerró; puede que se haya probado sin anotarlo.

**Sin probar**

1. **Tareas, 2.2.5:** el «Terminado» pedía que Johan creara, completara, moviera y descompletara desde
   el teléfono contra producción, consultando D1. Los hallazgos dicen «el dedo en un teléfono real y
   la tablet tampoco se han probado», y no encontré la prueba después. **Abierto.**
2. **Tareas, 2.2.4:** la vista derivada se comparó contra `wrangler dev`, «sin probar contra
   producción». Lo cubriría el punto 1.
3. **Tareas, 2.2.6:** el aviso `notificationAccess` en Android 14+ nunca se vio en pantalla (el teléfono
   es API 33). La tablet (Android 16) ya tiene la APK. La rama web de recordatorios tampoco se probó
   en un navegador real.
4. **Hábitos, 2.1.5:** la vista a 1280 × 800 solo se vio en navegador, no en la tablet.
5. **Hábitos, 2.1.x:** la penalización de XP no se ejercitó en producción; su `INSERT` solo lo cubre
   el test contra SQLite.
6. **Hábitos, 2.1.6:** la marca tardía se simuló con 32 s de reloj atrasado, «no una noche real».
7. **Pomodoro, 2.3.1:** la serie B se cerró por decisión de Johan sin medición cuantitativa.
8. **Diario, 2.4.6:** el conflicto entre dispositivos se probó con el «PC» simulado desde el WebView,
   porque la v2 no corre en el PC.

**Defectos conocidos sin arreglar**

9. **Pomodoro, 2.3.7:** una sesión que cruza la medianoche cuenta para el día de su `finished_at`, pero
   la recta de la jornada la dibuja por su `started_at`.
10. **Pomodoro, 2.3.7:** el «25 → 1 que quedó en 25» de la configuración no se reprodujo.
11. **Hábitos, 2.1.x:** los picos de CPU de 25–51 ms siguen sin explicar (hipótesis: arranque en frío).
12. **Hábitos, 2.1.3:** de baja prioridad: el origen de las 6 marcas de hoy en los hábitos `Bench` y el
    error 7403 de la migración.

**Deuda anotada**

13. **Diario:** `ponytail:` sin fusionar `PUT` pendientes en la cola.
14. **`ROADMAP.md`:** react-router 6 → 7 (`npm audit`), `manualChunks` (bloque de más de 500 kB), la
    ventana de historial por duplicación y vigilar los 1102.
15. **Datos de prueba en producción** (tareas «Prueba rec A/B», sesiones de 1 min, la entrada del
    14-nov): se van al vaciar la base en la fase 4; no se borran antes sin preguntarle a Johan.

---

## Hallazgos

(vacío)
