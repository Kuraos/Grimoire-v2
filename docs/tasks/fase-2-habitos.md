# Fase 2.1 — Hábitos de punta a punta

Depende de: fase 0 (dominio, worker, D1, APK), fase 1 (sistema visual y navegación) y
la caracterización de la v1 (`docs/tasks/caracterizacion-v1.md`, goldens en
`api/crates/domain/tests/golden/habits/`).

Objetivo: que Hábitos funcione en la v2 como en la v1, con las diferencias de la tabla
«Diferencias permitidas» de `caracterizacion-v1.md` y nada más. Es el primer módulo del
mínimo para dejar la v1 (`ROADMAP.md`): rachas, cadencias, XP, niveles, vidas y
penalización. Lo transversal que Hábitos necesita (usuario con XP, nivel, título y
vidas) nace aquí.

Cada tarea es una sesión de agente. Al terminar: verificación de `AGENTS.md` en verde,
un commit por tarea (`fase-2: <tarea>`) y una línea en «Hallazgos» si apareció algo. Si
una tarea revela que una decisión no se sostiene, se para y se anota, en vez de rodearla.

---

## Decisiones (Johan, 2026-10-30)

1. **Gracia: `D` se asienta cuando `hoy >= D + 3`** (`settled_through <= hoy − 3`).
   Corregido en la decisión 2 del ADR 0005 y en la fila 2 de «Diferencias permitidas»:
   con `D + 2`, el día `hoy − 2` podía asentarse el mismo día en que todavía se aceptan
   marcas para él.
2. **Logros: solo backend y toast.** Se portan los que dispara marcar (2.1.3); la vista
   de Logros sigue en la fase 5+. El catálogo completo (27) se siembra igual, para que
   la migración de la fase 4 tenga dónde caer.
3. **Cola sin conexión en la 2.1.6, limitada a hábitos**, pero diseñada como cola
   genérica de mutaciones (id del cliente + idempotencia del servidor), para que
   Tareas y Diario la reutilicen sin rehacerla.

---

## Alcance: la v1 frente a la v2

| v1 | v2 | Nota |
|---|---|---|
| `GET /habits?include_archived` | igual | Añade `completion_rate`, `last_mark` (`{id, local_date}` o `null`). Sin `best_streak` ni `total_xp` (ADR 0007). |
| `GET /habits/{id}`, `/logs`, `/xp-series` | `GET /habits/{id}` | Un solo detalle: `best_streak`, `total_xp`, `last_completed`, marcas y serie de XP. Lee el historial completo de **un** hábito. |
| `POST /habits` | existe (fase 0) | Sin cambios. |
| `PATCH /habits/{id}` | nuevo | Editar, y restaurar con `active: true`. |
| `DELETE /habits/{id}` | nuevo | Archivar (`active = 0`); se conserva el historial. |
| `POST /habits/{id}/complete` | existe (fase 0) | Cambia la respuesta: `streak` real (dif. 6) y `achievements_unlocked: [...]` (dif. 4). |
| `DELETE /habits/{id}/complete` (la última del periodo) | `DELETE /habits/{id}/marks/{mark_id}` | Por id, para que reintentar sea idempotente (cola sin conexión). La UI deshace `last_mark`, que en la práctica es lo mismo que la v1. |
| `POST /user/evaluate-streaks` (al abrir) | `GET /user` asienta perezosamente | ADR 0005: asienta lo que toque, calcula lo provisional y devuelve los eventos. Nada de cron. |
| `GET/POST/DELETE /habit-categories` | igual | Catálogo con las 6 categorías por defecto de la v1. |
| `GET /stats` (solo `heatmap` para Hábitos) | `GET /habits/heatmap` | Marcas por `local_date` de los últimos 365 días. El resto de estadísticas es de la fase 5+. |

Fuera de alcance: vista de Logros, estadísticas, misiones, etiquetas como módulo (las
`tags` del hábito siguen siendo un texto y se filtran en el cliente), Dashboard.

---

## 2.1.1 — Test de goldens y marcado según las decisiones

- `crates/domain/tests/golden_habits.rs` lee cada `golden/habits/*.json` y reproduce
  los pasos con las funciones puras. Un simulador mínimo en el test (hábitos, marcas
  por hábito, XP, logros) traduce cada llamada (`POST /habits`, `…/complete`, `GET`) a
  funciones del dominio y compara campo por campo. Los `id` enteros de la v1 se mapean
  por `alias`. `serde_json` solo como `dev-dependency`: `grimoire-domain` no gana
  dependencias.
- Cada campo que no se compara lleva la referencia a su fila de «Diferencias
  permitidas»: `streak` de la respuesta de marcar (6), `achievement_unlocked` (4),
  vidas y penalización en los escenarios afectados (2 y 3), redondeo (1, ningún caso
  hoy). En vez de comparar, el test afirma el valor nuevo de la v2.
- Dominio: `mark` devuelve la racha real tras la marca (la misma que
  `current_streak` con la marca incluida, a la fecha de hoy) y, aparte, el XP calculado
  con previa + 1, como la v1 (dif. 6).
- Deshacer: función pura que valida si una marca se puede borrar (diario: su día no
  está asentado; semanal: es de la semana ISO en curso, como en la v1) y calcula el
  XP que se devuelve.

Terminado: los 7 goldens pasan, con las diferencias marcadas una por una. Gate de
`AGENTS.md` en verde.

## 2.1.2 — Vidas y penalización (ADR 0005)

- Dominio: `evaluate_days(estado, días, hábitos, marcas) -> (estado, eventos)` como
  fold puro. Reglas de la v1: un día roto quita una vida o, con 0 vidas, cobra 15 XP;
  un día perfecto devuelve una vida hasta 3. Un hábito solo cuenta los días en que toca
  y desde que existe. Se rompe contra la ocasión anterior del propio hábito. Una sola
  vida o penalización por día, aunque se rompan varios hábitos. Recuperación de hasta
  14 días como en la v1 (`_SCAN_WINDOW_DAYS`); los días anteriores se dan por asentados
  sin evaluar.
- Sin el off-by-one de la v1 (dif. 3): se asienta desde `settled_through + 1`.
- Tests propios, con valores esperados derivados a mano de las reglas, para los
  escenarios de `racha_rota`, `dia_perfecto` y `diario_lv` con evaluación diaria (lo que
  la v1 no hacía). Incluye una marca tardía que llega antes de asentar y deshace la
  pérdida provisional.
- Migración `0002`: `users.lives` (`INTEGER NOT NULL DEFAULT 3`, `CHECK 0..3`) y
  `users.settled_through` (`TEXT`, `NULL` = nunca). La penalización se escribe en
  `xp_log` (`source = 'streak_penalty'`) solo al asentar, respetando el piso en 0.
- Worker: `GET /user` asienta los días pendientes y calcula los provisionales. Devuelve
  `xp`, `level`, `title`, `lives` (provisionales), los campos de la barra de XP como la
  v1 y `events` con `{day, kind, habits, provisional}`.
- **Asentar es una escritura concurrente** (teléfono y tablet abren a la vez). Va
  condicionada al valor leído, en un solo `batch` con la penalización:
  `UPDATE users SET lives = ?, xp = max(0, xp − ?), settled_through = ? WHERE
  settled_through IS <leído>`. Ojo: el `batch` ejecuta todas sus sentencias aunque el
  `UPDATE` no afecte filas, así que el `INSERT` de la penalización en `xp_log` lleva la
  misma guarda (`INSERT … SELECT … FROM users WHERE settled_through IS <leído>`, antes
  del `UPDATE`, con el monto aplicado calculado en SQL contra el XP de ese momento). Si
  el `UPDATE` no afectó filas, otro request ya asentó: se relee y se responde sin
  cobrar. Verificar en la documentación de D1 (versión de `wrangler` fijada) que el
  `batch` corre como una transacción.
- Test de concurrencia: dos asentamientos construidos a partir del **mismo** estado
  leído y aplicados uno tras otro contra D1 local. La vida (o la penalización) se cobra
  una sola vez, hay una sola fila de penalización en `xp_log` y `users.xp` sigue siendo
  la suma de `xp_log`. Además, dos `GET /user` en paralelo con `curl` tras un día roto.

Terminado: tests del dominio y de concurrencia en verde. Con `wrangler dev`, una
secuencia con `curl` (marca, salto, lectura a los días que toque, marca tardía) da las
vidas esperadas, y la salida va en «Hallazgos». CPU de `GET /user` medido en local.

## 2.1.3 — Logros que dispara marcar

- Dominio: reglas de `first_blood`, racha máxima actual entre los hábitos activos
  (7/30/60/100), `polymath` (4 categorías activas), `total_discipline` (7 días con todo
  lo programado hecho y un hábito que lleve la ventana entera) y nivel (5/10/15/20).
  Devuelve **todos** los que se desbloquean (dif. 4). `iron_constancy` cuenta semanas
  en los semanales (dif. 7, se conserva).
- Migración: tabla `achievements` (`key` como PK, `unlocked_at`), sembrada con el
  catálogo de 27 de la v1.
- `complete` devuelve `achievements_unlocked`. La racha máxima entre los hábitos
  activos usa la **lectura acotada del ADR 0007** (ventana de 90 días, ampliada solo en
  el borde), no el historial completo. Los umbrales de 60 y 100 pueden caer en el borde
  y ampliar: es el mismo techo de `GET /habits`. Se mide el CPU de `complete` igual,
  porque ya estaba cerca de 10 ms (fase 0, 0.3).

Terminado: el golden `logros` pasa (con la dif. 4 afirmada). CPU de `complete` con el
seed sintético anotado en «Hallazgos».

## 2.1.4 — Resto de la API de hábitos

- `PATCH /habits/{id}`, `DELETE /habits/{id}`, `GET /habits?include_archived`,
  `GET /habits/{id}` (detalle), `GET /habits/heatmap`, `GET/POST/DELETE
  /habit-categories` (borrar una categoría en uso se rechaza con el mensaje de la v1; la v1 responde 400, la v2 usa 409 como el resto de rechazos), y
  `DELETE /habits/{id}/marks/{mark_id}`.
- Deshacer (dif. 5): `xp_log` gana `mark_id` (migración nueva) y cada concesión lleva
  su marca. Deshacer escribe `−concesión` con el mismo `mark_id`. Si el piso en 0
  recorta lo aplicado, escribe además una fila `source = 'xp_floor'` por la diferencia,
  para que `users.xp` siga siendo la suma de `xp_log` y el `total_xp` del hábito no
  cuente marcas borradas. Reintentar el mismo `DELETE` → 200 sin efecto.
- `completion_rate` en la lista: se calcula con un agregado en SQL (marcas en días
  programados frente a ocasiones desde la creación; semanas que alcanzan la meta en
  los semanales), sin cruzar fechas a wasm. Si no cabe en CPU, pasa al detalle y se
  anota.
- Medir CPU y filas leídas de `GET /habits` y `GET /habits/heatmap` con el seed de la
  0.3. Criterio de la fase 0: mediana por debajo de 10 ms.

Terminado: secuencia de `curl` contra `wrangler dev` cubriendo cada ruta, incluido el
deshacer con piso (`total_xp` del detalle sin la marca borrada). Mediciones en
«Hallazgos».

## 2.1.5 — Vista Hábitos

Portar `frontend/src/pages/Habits.tsx` de la v1 (531 líneas) adaptándola, según
`docs/DESIGN_SYSTEM.md`. Los componentes ya están en el repo: `HabitCardGothic`,
`SectionBand`, `Figure`, `Modal`/`Overlay` (hoja inferior en teléfono), `TagInput`,
`HabitHeatmap`, `HabitConstellation`, `HabitXPChart`, `LevelUpOverlay`,
`ToastAchievement` y `TopBar` (vidas). No se crean componentes salvo justificación en
el commit.

- Capa de datos en `app/src/api/` + hooks. El cliente actual (`app/src/api.ts`, de la
  0.4) se absorbe ahí. Los componentes siguen sin llamar a la API.
- Partes de la vista: lista por categoría con marcar y deshacer (`last_mark`); resumen
  (heatmap, racha más larga entre las **actuales**, como la v1, constancia media y
  marcas en 12 meses); constelación; formulario de crear y editar; categorías;
  archivar y restaurar; detalle con gráfico de XP y marcas.
- Al abrir la app: `GET /user` y toasts de `events` («Racha rota», «Vida recuperada»).
  Los provisionales dicen que lo son (ADR 0005). Un evento no se repite en toasts: se
  recuerda el último mostrado.
- Toast por **cada** logro de `achievements_unlocked` (dif. 4).
- La página temporal `Prueba04` se retira; `/habitos` la reemplaza.

Terminado: `npm run typecheck && npm test && npm run build` en verde. Capturas a
393 × 852 y 1280 × 800 de la lista, el formulario (como hoja inferior y como modal) y
el detalle, revisadas según «Cómo se verifica una vista». Johan marca y deshace desde
el teléfono contra la API desplegada (el deploy lo hace o lo autoriza él).

## 2.1.6 — Cola sin conexión (genérica, usada primero por hábitos)

- Cola genérica de mutaciones en `app/src/api/`: cada entrada es una request (método,
  ruta, cuerpo) cuyo efecto es idempotente porque lleva el id que generó el cliente
  (ADR 0004). No sabe nada de hábitos: Tareas y Diario la reutilizan solo con sus
  rutas. Persistente (sobrevive a cerrar la app), en orden, y se vacía al volver la
  señal.
- Contrato que debe cumplir cada ruta que pase por la cola: repetirla con el mismo id
  da el mismo resultado. Ya lo cumplen crear y marcar (fase 0); la 2.1.4 lo da al
  deshacer, y editar y archivar lo cumplen por ser asignaciones. Las rutas de hábitos
  que entran: crear, editar, archivar, marcar (con el `local_date` del momento de la
  acción) y deshacer.
- La UI aplica el cambio de forma optimista y marca lo pendiente. Una marca rechazada
  al sincronizar (409, fuera de la ventana de gracia) se muestra, no se descarta en
  silencio.

Terminado: en el teléfono en modo avión, marcar dos hábitos, cerrar la app, recuperar
la señal al día siguiente: las marcas quedan con el día correcto y la vida provisional
perdida vuelve. Captura o registro en «Hallazgos».

---

## Hallazgos

(Agregar aquí lo que se descubra: mediciones, APIs que no funcionaron como dicen los
docs, decisiones tomadas sobre la marcha.)

- **2.1.1** (2026-10-30, Bogotá):
  - `api/crates/domain/tests/golden_habits.rs` reproduce los 7 goldens (168 pasos).
    Para comprobar que no pasa en vacío, tres mutaciones lo hacen fallar en el paso
    esperado: sin el residuo de la fila 5 (`deshacer`, paso 20), exigir que la racha de
    la respuesta sea previa + 1 (`semanal_2x`, paso 1, fila 6) y mover el umbral del
    multiplicador de 7 a 8 (`diario_lv`, paso 19).
  - Los pasos de `evaluate-streaks` aplican la penalización que registró la v1 (filas
    2 y 3), para que el XP de los pasos siguientes siga siendo comparable. Las vidas no
    se comparan hasta la 2.1.2.
  - `mark` recibe `today` y devuelve la racha real; el XP sigue saliendo de la racha
    previa + 1 al día de la marca. Una marca tardía que tapa un hueco ahora responde la
    racha de hoy (3 en vez de 2 en `late_mark_for_a_past_day`).
  - `check_undo`: en un diario se puede deshacer dentro de la ventana de gracia (hoy,
    ayer, anteayer). La v1 solo deshacía la de hoy, pero tampoco marcaba días pasados:
    es una extensión, no una diferencia que muestre ningún golden. En un semanal, dentro
    de la semana ISO en curso, como la v1.
  - Worker: `complete` amplía el historial si la racha llega al borde en el día de la
    marca **o** en hoy (ADR 0007), porque la respuesta usa la de hoy. Con `wrangler dev`
    (puerto 8799), un semanal 2× creado el lunes: 1.ª marca (hoy) → `streak 0`;
    2.ª marca (ayer) → `streak 1`; reintento de la 1.ª → `streak 1`, `xp_earned 0`;
    `GET /habits` → `streak 1`. Para marcar «ayer» se adelantó el `created_at` del
    hábito en la base **local**.
  - Había 12 `workerd` huérfanos de sesiones anteriores (todos de las 00:33–00:54); no
    los toqué. Los dos de esta sesión se cerraron.
