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
   de Logros sigue en la fase 5+. El catálogo completo (34) se siembra igual, para que
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

- Dominio: reglas de `first_blood`, racha del hábito marcado (7/30/60/100, dif. 8), `polymath` (4 categorías activas), `total_discipline` (7 días con todo
  lo programado hecho y un hábito que lleve la ventana entera) y nivel (5/10/15/20).
  Devuelve **todos** los que se desbloquean (dif. 4). `iron_constancy` cuenta semanas
  en los semanales (dif. 7, se conserva).
- Migración: tabla `achievements` (`key` como PK, `unlocked_at` y los textos del
  catálogo), sembrada con los 34 de la v1.
- `complete` devuelve `achievements_unlocked`. Lee los ya desbloqueados en su `batch` de
  lectura y no los vuelve a evaluar. La racha es la que ya calculó para el hábito
  marcado. `polymath` y `total_discipline` solo leen si siguen bloqueados: el conteo de
  categorías y 7 días de marcas. Se mide el CPU de `complete`, porque ya estaba cerca de
  10 ms (fase 0, 0.3).

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
- **2.1.2** (2026-10-30, Bogotá):
  - Dominio: `lives.rs` con `evaluate_days`, `settle_range` y `provisional_range`.
    `SETTLE_LAG_DAYS = GRACE_DAYS + 1`, y un test comprueba que nunca se asienta un día
    que todavía acepta marcas. Los 8 tests replican `racha_rota`, `dia_perfecto` y
    `diario_lv` con evaluación diaria, con valores derivados a mano. Con un hábito
    alternado, la v2 pierde y recupera la vida cada día y nunca llega a 0; la v1 llegaba
    a 0 por el off-by-one.
  - Migración `0002_lives.sql`: `users.lives` y `users.settled_through`.
  - D1: «Batched statements are SQL transactions» y se ejecutan «sequentially,
    non-concurrently» (developers.cloudflare.com/d1/worker-api/d1-database, consultado
    el 2026-10-30). La página no define `meta.changes`. En vez de leerlo, el `UPDATE`
    lleva `RETURNING xp`: sin fila devuelta, otro request asentó primero.
  - Guarda en las dos sentencias (`settled_through IS <leído>`), con la penalización
    **antes** del `UPDATE`. Test en `crates/worker/src/user.rs` con las sentencias
    reales contra SQLite (`rusqlite` como `dev-dependency`; SQLite 3.50.2): vida,
    penalización, `settled_through` NULL, piso en 0 y XP en 0. Si se quita la guarda del
    `INSERT`, fallan los dos tests de penalización. Se agregó
    `cargo test -p grimoire-worker` a la verificación de `AGENTS.md`.
  - `wrangler dev` (puerto 8799, base local), hoy = 2026-10-30, se asienta hasta el 27:
    - dos `GET /user` en paralelo, nunca asentado: con 3 vidas → 2, un solo evento
      `life_lost` del 27; con 0 vidas → una sola fila `streak_penalty` (−15) y
      `users.xp` = suma de `xp_log` (312).
    - D1 local serializó los dos requests en las tres corridas: según los logs, el
      segundo siempre leyó ya asentado y no intentó escribir. **La rama de conflicto
      (`UPDATE` sin fila) no se ejercitó por HTTP**; la cubre el test contra SQLite.
    - Marca tardía: con el 27 marcado y sin marcas el 28 ni el 29, `GET /user` → 2
      vidas (28 `life_lost`, provisional). Marca del 28 → 29 `life_lost` provisional.
      Marca del 29 → 3 vidas, sin eventos. Marca del 27 (ya asentado) → 409.
  - Tiempo total de `GET /user` en local: mediana 25,5 ms (6–87 ms, n = 12). **CPU sin
    medir**: las trazas locales de wrangler no lo traen (`spans.attributes` vacío). Se
    mide con `wrangler tail` cuando se despliegue.
  - Para aislar la prueba se archivaron en local los hábitos del seed y luego se
    restauraron; el hábito de prueba «Lectura vidas» quedó archivado.
  - `wrangler d1 execute --local` deja procesos `workerd` huérfanos: unos 10 de esta
    tarea (01:06–01:07), además de los anteriores. El modo automático bloqueó
    cerrarlos; quedan para Johan.
  - **CPU de `GET /user` en producción** (2026-10-30, Bogotá; versión `d1e8cb69`, seed de
    la 0.3 más «Prueba celular» y `bench-escritura`, 20 hábitos diarios activos).
    `cpuTime` de `wrangler tail`. Cada muestra con pendientes se preparó con un `UPDATE`
    remoto de `settled_through` y `lives = 0`. El máximo es de 12 días asentados
    (de hoy − 14 a hoy − 3, por `SCAN_WINDOW_DAYS` y `SETTLE_LAG_DAYS`).

    | Caso | n | CPU mediana | CPU mín–máx | > 10 ms | wall mediana | Filas leídas / escritas |
    |---|---|---|---|---|---|---|
    | Sin días pendientes | 20 | 8,5 ms | 3–38 | 7/20 | 29 ms | 292 / 0 |
    | 1 día pendiente | 10 | 7 ms | 5–10 | 0/10 | 69 ms | 294 / 1 |
    | 12 días pendientes | 10 | 6,5 ms | 4–20 | 1/10 | 70,5 ms | 294 / 1 |

    - Asentar no sube el CPU de forma visible: el costo es la escritura, que se ve en el
      wall. Las 40 requests dieron 200.
    - Los picos (25–38 ms) salen en la tanda sin pausas. Parecen los de la fase 0; sigue
      sin verificarse la causa.
    - **La penalización no se ejercitó en producción:** con este seed los días perfectos
      devuelven vidas antes de cada día roto (máximo: 5 `life_regained`, 2 `life_lost`,
      XP constante). Ese `INSERT` solo lo cubre el test contra SQLite.
- **2.1.3** (2026-10-30, Bogotá):
  - **El plan de leer la racha de todos los hábitos no cupo.** Versión `51806629`, con
    `_max_current_streak` de la v1 sobre la lectura acotada: `complete` 200, n = 3,
    **48–53 ms de CPU** (mediana 52), ~3 800 filas leídas (2 897 de la ampliación de los
    otros hábitos). Muestra corta y justo después del deploy, pero se tomó como suficiente:
    Johan rediseñó la revisión en vez de ampliar la medición.
  - **Rediseño:** los logros ya desbloqueados se leen en el `batch` de lectura y no se
    reevalúan. La racha es la del hábito marcado. `polymath` y `total_discipline` solo
    leen mientras estén bloqueados: el conteo de categorías y 7 días de marcas. La
    diferencia es la fila 8 de `caracterizacion-v1.md`, y la cubre el backfill del ADR 0006.
  - **Sin tope de racha para logros:** la ampliación del hábito marcado la pide el `streak`
    real de la respuesta (fila 6), no el logro. Un tope no ahorra lectura sin cambiar esa
    respuesta.
  - **CPU del rediseño** (versión `942fe533`; `polymath` y `total_discipline` bloqueados,
    el camino más caro):

    | Request | n | CPU mediana | CPU mín–máx | > 10 ms | wall mediana | Filas leídas |
    |---|---|---|---|---|---|---|
    | `complete` 200 (marca nueva) | 10 | 9 ms | 6–14 | 2/10 | 92,5 ms | ~215 (38 + ~176 + 1); 7 escritas |
    | `complete` 409 | 30 | 3,5 ms | 2–39 | 6/30 | 22 ms | 84–128, más 757–1 077 si amplía |

    - Las 10 marcas son de los `bench-escritura`, con poco historial propio: los hábitos
      `Bench` ya tenían hoy, ayer y anteayer ocupados. **No hay medición de un 200 cuyo
      propio hábito amplíe.** Lo más cercano son los 409 que amplían: 3–6 ms en caliente,
      con 13–39 ms en los tres primeros, tras el deploy.
    - La mediana de 9 ms queda justo debajo del límite mientras `total_discipline` siga
      bloqueado, que puede ser mucho tiempo. No se aisló qué parte gasta más.
  - **Sin explicar:** en la primera tanda, 6 de los 10 hábitos `Bench` ya estaban marcados
    ese día, y no sé por qué.
  - Catálogo: la v1 tiene **34** logros, no 27 como decía este plan, porque no contaba los
    7 de entrenamiento. Se siembran los 34 con `name`, `description`, `icon` y `tier`.
  - `UPDATE … WHERE unlocked_at IS NULL … RETURNING key`: dos marcas concurrentes no
    informan el mismo logro. Si no hay logros nuevos, la sentencia no se manda.
  - El primer `wrangler d1 migrations apply --remote` de la `0003` falló con el código 7403
    («account is not valid or is not authorized»). `migrations list` funcionó enseguida y
    el reintento aplicó la migración. Parece transitorio; no se investigó más.
  - Local: con los logros reiniciados y un hábito del seed con racha larga, marcar un
    hábito nuevo da `[first_blood, polymath]`, sin logros de racha (fila 8). El reintento
    da lista vacía y otra marca del mismo día, 409.
  - **Escala real** (dato de Johan, 2026-10-30): la v1 tiene 15 hábitos activos y 70
    marcas (máx. 6 por hábito). El seed de bench, con ~9 400 marcas, es ~130× más pesado,
    así que los 9 ms de mediana de `complete` son una cota de peor caso frente al uso
    real. Dos matices: el factor 130 es de marcas, no de hábitos (21 activos en la base
    medida frente a 15), y la lectura de `total_discipline` crece con los hábitos; y esas
    10 marcas no ampliaron la lectura de su propio hábito, lo que solo pasa con rachas de
    más de 90 días.
  - **Pendientes de baja prioridad:** el origen de las 6 marcas de hoy en los hábitos
    `Bench` y el error 7403 de la migración.
- **2.1.4** (2026-10-30, Bogotá):
  - **CPU sin medir:** la tarea no se desplegó (Johan lo pide aparte). Falta aplicar la
    migración `0004` remota, desplegar y medir `GET /habits` y `GET /habits/heatmap` con
    `wrangler tail`. Este criterio del plan queda abierto.
  - **Filas leídas**, en local con el seed (9 417 marcas, 21 hábitos activos; solo cuenta
    D1, no el CPU):

    | Request | Filas leídas | Nota |
    |---|---|---|
    | `GET /habits` | 19 882 + 2 894 de ampliación | Antes: ~900 + 2 897. |
    | `GET /habits/heatmap` | ~12 580 | Escanea todas las marcas: no hay índice por `local_date` solo. |
    | `GET /habits/{id}` del hábito más largo | 1 080 | Una fila por marca, como prevé el plan. |

    - **`completion_rate` en la lista rompe la cota del ADR 0007:** ese agregado recorre todo
      el historial, así que estas filas crecen con los años. Con el seed caben ~219
      `GET /habits` al día en los 5 M de cuota. Con `JOIN` desde `habit_logs` eran ~39 270
      filas; recorrer desde `habits` (`CROSS JOIN`, índice `(habit_id, local_date)`) las
      bajó a la mitad. Con las 70 marcas reales son unos cientos de filas (estimado, no
      medido). Si llegara a pesar, el plan ya prevé pasarlo al detalle.
  - `last_mark` sale de la ventana de 90 días: una marca más vieja da `null`, y de todos
    modos ya no se puede deshacer.
  - `completion_rate` comparado en los 7 goldens: `format!("{:.1}")` redondea como
    `round(x, 1)` de Python (6,25 → 6,2). Un test con las sentencias reales comprueba que
    el agregado en SQL y `done_units` del dominio cuentan lo mismo (diario, L–V, solo
    domingo y semanal 2×).
  - Deshacer: las 4 sentencias del `batch` exigen que la marca siga existiendo, con el
    borrado de último; dos deshacer seguidos devuelven el XP una sola vez. Una marca
    inexistente da 200 sin efecto, y la de otro hábito, 409. Se puede deshacer en un hábito
    archivado, como en la v1. Por eso `read_mark_state` ya no filtra por `active`;
    `complete` responde 404 aparte. Las marcas previas a la `0004` no tienen `mark_id`:
    deshacerlas no devuelve XP.
  - La respuesta de `PATCH` es el hábito sin racha, igual que `POST /habits`. La v1
    devolvía el hábito enriquecido; la UI lee racha y constancia de `GET`. `GET /habits`
    ahora ordena por categoría y nombre, como la v1. CORS ahora permite `PATCH` y `DELETE`.
  - La `0004` no agrega al catálogo las categorías de hábitos ya existentes que no estén
    entre las 6 por defecto. Solo hay datos de prueba, y la migración de la v1 trae su
    propio catálogo.
  - **`wrangler dev`** (puerto 8798, base local), todo como se esperaba:
    ```
    crear con categoría nueva → 201, la categoría entra al catálogo con habit_count 1
    borrar categoría en uso   → 409 «Cat214» está en uso por 1 hábito(s)…
    PATCH days/notes null     → 200, quedan en null; xp_reward 5 → 422; id inexistente → 404
    categoría: crear 201, reintento 200, otras mayúsculas 409, borrar 204, otra vez 404
    marcar → xp +20; detalle: total_xp 20, last_mark y marcas; heatmap cuenta la marca
    deshacer → xp −20, streak 0; reintento → 200, xp_earned 0
    XP en 5, deshacer con piso → xp_earned −5, new_xp 0; filas de la marca: +20, −20 y
      xp_floor +15; total_xp del detalle 0, sin la marca borrada
    deshacer con otro hábito → 409; marca fuera de gracia → 409
    archivar 204, otra vez 204; fuera de la lista, dentro de include_archived=true
    marcar archivado → 404; restaurar con active:true → 200
    OPTIONS → Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
    ```
    Los hábitos «Ruta 214» y «Ruta 214 otro» quedan archivados en la base local, con el XP
    local alterado por la prueba del piso.
