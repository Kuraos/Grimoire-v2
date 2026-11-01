# Fase 2.2 — Tareas de punta a punta

**Estado: plan aprobado por Johan el 2026-10-31.**

Depende de: fase 2.1 (usuario, XP, logros y cola sin conexión, ADR 0008) y la caracterización
de la v1 (`docs/tasks/caracterizacion-v1.md`, goldens en
`api/crates/domain/tests/golden/tasks/`).

Objetivo: que Tareas y Proyectos funcionen en la v2 como en la v1, con las diferencias de la
tabla de abajo y nada más. Es el segundo módulo del mínimo para dejar la v1 (`ROADMAP.md`).

Cada tarea es una sesión de agente. Al terminar: verificación de `AGENTS.md` en verde, un commit
por tarea (`fase-2: <tarea>`) y una línea en «Hallazgos» si apareció algo. Si una tarea revela
que una decisión no se sostiene, se para y se anota, en vez de rodearla.

---

## Decisiones

Las 1, 2, 4, 5 y 6 las fijó Johan al pedir este plan (2026-10-31). La 3 y de la 7 en adelante
las propuso el plan, y Johan las aprobó con él.

1. **Orden del kanban con claves fraccionarias.** `tasks.rank` (`TEXT`, solo `[0-9A-Za-z]`) y
   `ORDER BY rank, id`. El cliente calcula la clave entre las dos vecinas una sola vez, al
   soltar, y la manda en la request: mover escribe **una sola fila** y repetirlo da lo mismo. Sin
   `position` entera. Dos dispositivos sin conexión pueden generar la misma clave: el `id`
   desempata de forma estable. La función `rankBetween(a, b)` vive en el cliente, con tests
   propios (orden estricto en 10 000 inserciones aleatorias), sin dependencia nueva. El servidor
   solo valida el formato. Sin rebalanceo: con un usuario, las claves crecen muy despacio; se
   mide con los datos migrados.
2. **Completar y descompletar idempotentes con id de concesión.**
   - `POST /tasks/{id}/complete` con `{id: <concesión>, local_date, rank?}`. Se reutiliza
     `xp_log.mark_id`, que ya es el id de concesión de Hábitos, y `tasks.grant_id` guarda la
     concesión vigente. Si ese id ya existe en `xp_log`, responde 200 sin efecto.
   - `POST /tasks/{id}/uncomplete` con `{grant_id, status?, rank?}`. Devuelve el saldo de **esa**
     concesión, con la fila `xp_floor` de Hábitos si el piso recorta. Con saldo 0, o si
     `grant_id` ya no es la vigente, responde 200 sin efecto.
   - Completada con otro id: 409 visible (dos dispositivos sin conexión). La segunda no paga.
3. **`remind_at` entra el día 1 como notificación local.** Va al final (2.2.6) y no bloquea lo
   demás.
   - **Por qué ahora:** es la razón del APK (ADR 0003), la dependencia ya está instalada, y
     Pomodoro, el módulo siguiente, necesita el mismo permiso y el mismo flujo de alarma exacta.
     Dejar la v1 sin recordatorios sería perder una función.
   - **Cómo:** una función pura compara la lista de tareas con lo agendado; se agendan las
     abiertas con `remind_at` futuro y se cancela el resto, al abrir y tras cada sincronización.
     El UUID se convierte en un `id` de 32 bits, con la colisión resuelta en esa función.
   - **Límite:** un cambio hecho en otro dispositivo solo se agenda al abrir la app en este.
   - **PC:** se conserva la conducta de la v1 con la app abierta, sobre la lista ya cargada.
   - **Alternativa:** dejarlo para después de Pomodoro ahorra una sesión, pero el campo quedaría
     en el formulario sin avisar en el teléfono.
4. **`vault_note_path`: se migra sin UI.** Columna en `tasks` y `projects`, que solo escribe la
   migración. Ni se recibe ni se devuelve en la API, así que un formulario no puede borrarla.
5. **`tags`: texto separado por comas, igual que la v1.** Sin tablas ni normalización.
6. **Todas las mutaciones pasan por la cola de la 2.1.6:** tareas, proyectos y checklist. Cada
   ruta cumple su contrato (tabla de abajo). Eso obliga a que repetir un `DELETE` dé 204, que es
   lo que dejó fuera a las categorías.
7. **`status` es la única verdad.** Sin columna `completed`: la API la deriva de
   `status = 'done'`. Entrar o salir de `done` solo es posible por `complete` y `uncomplete`, con
   XP y orden en una sola request. `PATCH` admite `todo` y `doing`; crear o `PATCH` con `done` da
   422. Se migra como `done` lo que tenga `completed` o `status = 'done'` en la v1.
8. **`tasks.completed_on`** (`YYYY-MM-DD`), fijado al tocar, como `local_date` en una marca
   (invariante 3): una tarea completada sin conexión conserva su día, y `completed_at` es la
   sincronización. No hay ventana de gracia: las tareas no tienen rachas. Solo se rechaza un día
   futuro.
9. **Tablero táctil sin arrastre.** `KanbanBoard` usa arrastre HTML5, que no funciona con el
   dedo. En teléfono: una columna a la vez con `Segmented` y una hoja inferior «Mover» (columna,
   subir, bajar). En tablet, la misma hoja con las tres columnas visibles. Con ratón se conserva
   el arrastre. Sin dependencia nueva.

---

## Diferencias con la v1

Aprobadas con el plan. Están en «Diferencias permitidas» de `caracterizacion-v1.md`, filas 11 a
22. También aplica la fila 4 (todos los logros desbloqueados en la respuesta).

---

## Alcance: la v1 frente a la v2

| v1 | v2 | Nota |
|---|---|---|
| `GET /tasks` con filtros y `sort` | `GET /tasks` | Trae la checklist y sus conteos, en una sola lectura sin N+1. Filtros y orden, en el cliente con los mismos criterios. |
| `POST /tasks` | igual | Con `id` y `rank` del cliente. |
| `PATCH /tasks/{id}` | igual | También mueve: `{status?, rank?}`. Sin `completed`, `position` ni `vault_note_path`. |
| `DELETE /tasks/{id}` | igual | Borrado real; el XP se conserva, como en la v1. |
| `POST .../complete`, `.../uncomplete` | igual, con cuerpo | Decisión 2. Respuesta con `achievements_unlocked` (fila 4). |
| `POST /tasks/{id}/checklist` | igual | Con `id` del cliente. `position` = max + 1 en el servidor: la cola conserva el orden. |
| `PATCH`/`DELETE /tasks/checklist/{id}` | igual | `text` y `done`. |
| `GET/POST/PATCH/DELETE /projects` | igual | `tasks_total` y `tasks_pending` con un agregado. Borrar deja las tareas sin proyecto (`ON DELETE SET NULL`). |

Fuera de alcance: botón de iniciar pomodoro desde una tarea (llega con Pomodoro), `VaultNoteField`,
módulo de etiquetas, Dashboard.

### Contrato con la cola

| Ruta | Repetirla da |
|---|---|
| `POST /tasks`, `/projects`, checklist | El registro ya creado, con el mismo id. Sin duplicar. |
| `PATCH` | Las mismas asignaciones. |
| `DELETE` | 204, exista o no. |
| `complete` | 200 sin efecto: la concesión ya existe. |
| `uncomplete` | 200 sin efecto: saldo 0. |

---

## 2.2.1 — Esquema y dominio

- Migración `0005`: `projects`, `tasks` (con `rank`, `grant_id`, `completed_on`, `remind_at`,
  `tags`, `vault_note_path`; `project_id` con `ON DELETE SET NULL`) y `checklist_items` (`ON DELETE
  CASCADE`). Instantes en UTC RFC 3339; `remind_at` también. Verificar que D1 aplica las claves
  foráneas antes de confiar en ellas.
- Dominio puro: validaciones (`xp_reward` 5–50, prioridad, estado, formato de `rank`), decisión de
  completar y descompletar, cálculo de la devolución con piso, y logros de `task_complete`
  (`project_master`, `task_centurion` y los de nivel), que reciben ya calculados los conteos.
- `crates/domain/tests/golden_tasks.rs`: reproduce con funciones puras lo que es regla: XP, nivel,
  rechazos y logros de `completar_xp`, `descompletar_piso`, `logros_tareas` y `logro_por_patch`.
  Cada campo que no se compara cita su diferencia y afirma el valor de la v2.

Terminado: goldens de regla en verde, con las diferencias marcadas una por una.

## 2.2.2 — API de tareas

- `GET`, `POST`, `PATCH` y `DELETE`, sin checklist ni proyectos todavía.
- `complete` y `uncomplete` en un solo `batch` condicionado, como Hábitos. Test de concurrencia
  contra SQLite: dos `complete` con el mismo id y con ids distintos, a partir del mismo estado
  leído. Una sola concesión, y `users.xp` sigue siendo la suma de `xp_log`.
- `project_master` y `task_centurion` solo consultan si siguen bloqueados.
- Medir CPU de `complete` y de `GET /tasks` con un seed sintético de 2000 tareas. **Si la mediana de
  la lista pasa de 10 ms**, se acota a abiertas más completadas recientes, se pagina el resto y se
  anota como diferencia. No se acota antes de medir.

Terminado: `curl` contra `wrangler dev` cubriendo cada ruta, incluidas las repeticiones. Mediciones
en «Hallazgos».

## 2.2.3 — Checklist, proyectos y paridad de la API

Hecha dentro de la 2.2.2: Johan pidió reproducir ahí los goldens de CRUD, y esos goldens necesitan
estas rutas. `scripts/replay_golden.py` traduce alias a UUID, genera `id`, `rank` y concesiones, y
compara status y campos. Queda pendiente solo el CPU en producción.

## 2.2.4 — Capa de datos

- `app/src/api/tasks.ts` y `projects.ts`: `taskRequests` y `projectRequests` puros, `applyQueue` por
  recurso y `rankBetween`. La cola no cambia; si necesita cambiar, se para y se anota.
- Tests con arranques simulados, como `queue.test.ts`: crear proyecto y tarea sin conexión, en
  orden; completar y descompletar sin conexión; mover dos veces; borrar lo pendiente; 409 visible.
- Comprobar que los tests no pasan en vacío con mutaciones, registrando **qué test cae en cada una**.

Terminado: `npm run typecheck && npm test && npm run build` en verde.

## 2.2.5 — Vista Tareas

Portar `frontend/src/pages/Tasks.tsx` de la v1 (534 líneas), según `docs/DESIGN_SYSTEM.md`. En el
repo ya están `TaskCard`, `KanbanBoard`, `TagInput`, `TagFilterBar`, `ProgressSigil`, `Segmented`,
`Modal` y `SectionBand`. No se crean componentes salvo justificación en el commit.

- `KanbanBoard` y `TaskCard` pasan a ids de texto y orden por `rank`; `onReorder` recibe las claves
  vecinas en vez de la columna entera.
- Lista y tablero, proyectos, formularios (hoja inferior en teléfono), checklist, filtros y banda de
  vencimientos. Marca «pendiente» como en Hábitos.
- Sin campo de nota del vault ni pomodoro. Tablero táctil según la decisión 9.

Terminado: capturas a 393 × 852 y 1280 × 800 de lista, tablero, hoja «Mover» y formulario, revisadas.
Johan crea, completa, mueve y descompleta desde el teléfono contra la API desplegada (el deploy lo
hace o lo autoriza él), y **se consulta D1 antes de darlo por bueno**.

## 2.2.6 — Recordatorios

- Función pura de reconciliación, con tests, y hook que aplica el resultado con
  `@capacitor/local-notifications`. Flujo de alarma exacta del ADR 0003.
- En web: la conducta de la v1, sobre la lista ya cargada, sin sondear la API.

Terminado, en el teléfono: un recordatorio suena con la app cerrada; completar la tarea lo cancela;
editar la hora lo reagenda; se anota si sobrevive a reiniciar el teléfono.

---

## Hallazgos

(Agregar aquí lo que se descubra: mediciones, APIs que no funcionaron como dicen los docs,
decisiones tomadas sobre la marcha.)

- **2.2.1** (2026-10-31, Bogotá):
  - `golden_tasks.rs` reproduce la parte de regla de 4 goldens (`completar_xp`,
    `descompletar_piso`, `logros_tareas`, `logro_por_patch`). Difieren lo previsto: en
    `descompletar_piso`, un solo paso (fila 11; la v2 conserva 15 XP), y en `logro_por_patch`,
    el `PATCH` a `done` (fila 12), por lo que ahí no se desbloquea `project_master`.
  - Para comprobar que no pasan en vacío, 12 mutaciones del dominio hacen fallar `tasks.rs` o
    `golden_tasks.rs`. Qué test cae:
    - Reintento de `complete` que paga: `complete_grants_once…` y 4 goldens.
    - Completar lo completado: `complete_with_another_grant…`, `completar_xp`.
    - Día futuro aceptado: `complete_accepts_any_past_day…`.
    - XP fijo: `complete_grants_once…`, `completar_xp`, `descompletar_piso`, `logros_tareas`.
    - Devolver el doble: `uncomplete_refunds…`, `descompletar_piso`, `logros_tareas`.
    - Concesión vieja que reabre: `uncomplete_rejects…`, `uncomplete_retry…`.
    - Reintento de `uncomplete` que falla: `uncomplete_retry…`, `descompletar_piso`, `logros_tareas`.
    - `done` escribible: `done_is_not_writable`, `logro_por_patch`.
    - `rank` vacío: `rank_is_ascii_alphanumeric`. Checklist vacío: `checklist_text_must…`.
    - Sin `project_master`, y centurión en 101: `task_achievements…`, `logros_tareas`.
  - **Claves foráneas en D1 local** (`wrangler d1`, `0005` aplicada): `project_id` inexistente
    falla con `SQLITE_CONSTRAINT_FOREIGNKEY`, borrar el proyecto deja `project_id` en `NULL` y
    borrar la tarea borra sus ítems. Filas de prueba eliminadas. **`0005` no se aplicó en remoto.**
  - **Pendiente de la 2.2.2:** falta decidir cómo se registra lo restado por el piso en el saldo:
    Hábitos ya lo resuelve con `UNDO_GRANT` y `UNDO_FLOOR`, y se reutiliza.
- **2.2.2** (2026-10-31, Bogotá; incluye la 2.2.3):
  - Lo restado por el piso se anota como en Hábitos (`xp_floor`), y `uncomplete_respects_the_floor`
    comprueba que `users.xp` sigue siendo la suma de `xp_log`.
  - **Goldens contra `wrangler dev`** (`scripts/replay_golden.py`, base local aislada): los 8
    pasan. Cada escritura aceptada se repitió con el mismo id: mismo resultado y sin XP nuevo.

    | Golden | Pasos | Reintentos | Pasos con diferencia | Filas | XP final |
    |---|---|---|---|---|---|
    | `crear_y_validar` | 23 | 7 | 3 | 15, 17, 21 | 0 |
    | `kanban_estado` | 23 | 12 | 9 | 12, 13, 16 | 15 (v1: 45) |
    | `checklist` | 25 | 14 | 8 | 15, 18, 19 | 15 |
    | `proyectos` | 17 | 10 | 1 | 15 | 15 |
    | `completar_xp` | 25 | 19 | 0 | — | 415 |
    | `descompletar_piso` | 23 | 17 | 1 | 11 | 50 (v1: 35) |
    | `logros_tareas` | 212 | 204 | 0 | — | 2750 |
    | `logro_por_patch` | 7 | 4 | 3 | 12 | 15 |

    Los filtros de `GET /tasks` son del cliente (filas 20 y 21): aquí se comparan las tareas que
    devolvió la v1, pero el filtrado en sí se prueba en la 2.2.4. `pomodoro_hours` no se compara
    (fila 22). `GET /achievements` no existe en la v2: los logros se comparan con los que informan
    las respuestas.
  - **Filas leídas y escritas** con `wrangler dev`, seed de 500 tareas, 20 proyectos y 1 013 ítems
    (`scripts/bench_seed_tasks.py`). El tiempo local no es CPU:

    | Request | n | Filas leídas | Filas escritas | Wall local (mediana) |
    |---|---|---|---|---|
    | `GET /tasks` (355 683 bytes) | 10 | 2 013 | 0 | 31 ms |
    | `GET /projects` (4 307 bytes) | 10 | 464 | 0 | 20 ms |
    | `PATCH` mover (`status`, `rank`) | 5 | 3–8 | **1** | 22 ms |
    | `POST /tasks` | 5 | 3 | 3 | 19 ms |
    | `complete`, logros bloqueados | 5 | 448–959 | 6–7 | 33 ms |
    | `complete`, logros desbloqueados | 5 | 43 | 6 | 28 ms |

    - `GET /tasks`: 500 de lectura, 500 del ordenamiento por `rank` (sin índice) y 1 013 de ítems.
      No se añade índice: a 2 013 filas por lectura, los 5 M diarios de D1 dan para unas 2 400.
    - Mover escribe una sola fila, lo que pedía la decisión 1.
    - `complete` solo escanea mientras `project_master` o `task_centurion` siguen bloqueados.
  - **CPU en producción** (2026-10-31, Bogotá; versión `b07b7e19`, `0005` aplicada por Johan).
    `cpuTime` de `wrangler tail`, 20 requests por ruta, una por segundo, todas 200 y `outcome: ok`,
    con el seed de arriba (500 tareas; el plan pedía 2 000 y Johan fijó 500):

    | Request | n | CPU mediana | CPU mín–máx | > 10 ms | Wall mediana | Filas leídas |
    |---|---|---|---|---|---|---|
    | `GET /tasks` | 20 | **15,5 ms** | 12–61 ms | **20 de 20** | 36 ms | 2 013 |
    | `GET /projects` | 20 | 2 ms | 1–3 ms | 0 de 20 | 15 ms | 464 |

    **`GET /tasks` no cumple el criterio de 10 ms:** toca acotarla, según esta misma tarea. Ningún
    request falló, pero el mínimo ya pasa del límite, así que no es ruido. No se ha acotado todavía.
  - **El seed sigue en la base remota** (500 tareas, 20 proyectos, 1 013 ítems): sirve para volver a
    medir, y hay que borrarlo antes de la 2.2.5.
- **`GET /tasks` acotado y lectura compacta** (2026-10-31, Bogotá):
  - **Datos reales de la v1** (Johan, de una copia): 95 tareas (90 abiertas, 5 completadas), 10
    proyectos, 320 ítems (máximo 4 por tarea) y 0 completadas hace más de 90 días. La ventana no
    recorta nada hoy: lo que crece son las abiertas. Por eso el cambio principal es la checklist.
  - **Lectura compacta:** SQLite arma la checklist de cada tarea en una columna JSON y el worker la
    copia con `RawValue`, sin deserializar ítem por ítem. La forma de la respuesta no cambia:
    mismos bytes en el paso 1, y los goldens pasan. `json_group_array` queda sin `ORDER BY`: el
    índice `(task_id, position)` entrega el orden y `list_keeps_items_in_position_order` lo fija.
    SQLite no lo garantiza formalmente; si el test cae, el arreglo es volver al `ORDER BY`.
  - **Filas leídas de `GET /tasks` en local**, antes y después de cada paso (10 requests por caso,
    todas iguales). Seed `realista`: 100 abiertas, 5 recientes, 367 ítems. Seed `pesado`: 300
    abiertas, 200 hechas repartidas en dos años, 1 015 ítems:

    | Paso | Realista | Pesado | Tareas (R / P) | Bytes (P) |
    |---|---|---|---|---|
    | 0. Base: dos consultas, ítems deserializados | 577 | 2 015 | 105 / 500 | 357 628 |
    | 1a. `JOIN` con agregado (descartado) | 1 258 | 4 341 | 105 / 500 | 357 628 |
    | 1b. Correlacionada, `ORDER BY` en el agregado (descartado) | 1 048 | 3 529 | 105 / 500 | 357 628 |
    | 1c. Correlacionada, sin ese `ORDER BY` | 681 | 2 420 | 105 / 500 | 357 628 |
    | 2. 1c más la ventana de 90 días | 681 | 1 746 | 105 / 324 | 229 867 |

    - **La lectura compacta sube las filas leídas** (681 frente a 577): cada tarea cuenta una
      búsqueda en el índice. Lo que debe bajar es el CPU del worker, y eso solo se ve en producción.
    - A 681 filas, los 5 M diarios de D1 dan para unas 7 300 lecturas.
    - En 1a y 1b el aumento viene de materializar el agregado y del ordenador, que cuentan cada ítem
      más de una vez. El tiempo local no distingue los casos: 18–20 ms y 22–29 ms.
  - **`GET /tasks/history`:** de la más reciente a la más antigua, 50 por página, con cursor `día,id`.
    Con el seed `pesado`, 999 filas leídas en la primera página, porque recorre y ordena todas las
    tareas. Sin índice por ahora: es una ruta poco frecuente. `check_window` en
    `replay_golden.py` comprueba el borde de 90 días, las dos páginas sin saltos ni repeticiones, un
    cursor inválido (422) y que descompletar desde ahí devuelve la tarea a la lista.
  - **Goldens contra `wrangler dev`:** los 8 pasan como en la 2.2.2, con reintentos. La réplica ya
    no manda `local_date`, para que las fechas de los goldens no caigan fuera de la ventana.
  - **Sin medir:** CPU en producción con estos cambios. La opción B (ítems al abrir la tarea) solo
    entra si el seed `realista` queda por encima de 10 ms de mediana.
