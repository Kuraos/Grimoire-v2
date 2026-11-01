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
compara status y campos. El CPU en producción se midió después; ver «Hallazgos».

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
    medir, y hay que borrarlo antes de la 2.2.5. (Borrado después; ver abajo.)
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
  - **CPU en producción** (2026-10-31, Bogotá; versión `e48ada2d`). `cpuTime` de `wrangler tail`,
    `GET /tasks`, 20 requests por seed, una por segundo, todas 200 y `outcome: ok`:

    | Seed | Tareas devueltas | Bytes | CPU mediana | CPU mín–máx | > 10 ms | Wall mediana |
    |---|---|---|---|---|---|---|
    | `realista` | 105 | 95 247 | **3 ms** | 2–24 ms | 1 de 20 | 23,5 ms |
    | `pesado` | 324 | 229 867 | **5 ms** | 4–29 ms | 1 de 20 | 23 ms |

    **Cumple el criterio de 10 ms y la opción B (ítems al abrir la tarea) no entra.** Antes de la
    lectura compacta y la ventana, un seed comparable al `pesado` marcaba 15,5 ms de mediana, aunque
    no son los mismos datos exactos (500 tareas devueltas, 1 013 ítems). No se midió aparte qué parte
    de la mejora aporta cada cambio.
  - **El seed ya no está en la base remota:** `tasks`, `projects` y `checklist_items` quedaron en 0
    filas. El borrado encontró 472 tareas y 10 proyectos `Bench`, no los 500 y 20 anotados arriba;
    no se sabe por qué. Mandar los dos `DELETE` juntos con `--command` falló en remoto con
    `incomplete input`, aunque funciona en local; por separado funcionan.
- **2.2.4** (2026-10-31, Bogotá):
  - **La cola (`queryClient.ts`) no cambió.** Dos cambios al lado: `applyQueue` de Hábitos ahora
    ignora las rutas de otros recursos, porque un `POST /tasks` en cola se habría visto como un
    hábito fantasma; y `sync.ts` también guarda en disco `tasks/list` y `projects`, para abrir sin
    señal. El historial no se guarda. Por eso títulos de tareas y nombres de proyectos quedan en
    claro en el dispositivo, igual que los hábitos (ADR 0008, actualizado).
  - **Tipos:** `ApiTask`, `ApiProject` y `ApiChecklistItem` conviven con `Task` y `Project` de la
    v1, que aún usan `KanbanBoard`, `TaskCard`, `PomodoroIsland` y `CommandPalette` con ids enteros.
    La 2.2.5 debe reemplazar los de la v1 en los componentes que porte.
  - **Vista contra el worker real:** un test temporal (no queda en el repo) hizo 23 escrituras
    contra `wrangler dev` con una D1 local aparte, cada una mandada dos veces: proyecto, tareas,
    checklist, mover, completar, descompletar y borrar. En cada paso, `applyTaskQueue` coincidió
    campo por campo con `GET /tasks`, y `applyProjectQueue` con `GET /projects` en id, nombre, estado
    y color. **Sin probar contra producción.**
  - **Largo de `rankBetween` tras 1 000 inserciones:** 33 caracteres siempre al final (avanza un
    dígito), 167 siempre al principio y 168 siempre en el mismo hueco (parten a la mitad, unos 6 por
    carácter). Sigue sin rebalanceo (decisión 1); se revisa con los datos migrados.
  - **Claves de la migración:** entre `x` y `x0` no cabe ninguna clave, y la tarjeta queda después
    de las dos, sin error. La migración (fase 4) no debe generar claves que terminen en `0`.
  - **Mutaciones:** caen las 28, en `tasks.test.ts`. Una 29.ª sobrevivió, y era una guarda sin
    efecto en `rankBetween`, que se borró. Qué test cae:
    - `rankBetween`: `after` que no avanza, punto medio fuera del hueco y sin prefijo común caen en
      `la clave queda entre sus vecinas…` y `mil inserciones…`.
    - `rankAtEnd` sin filtrar por columna: `al final de una columna…`.
    - `move` como `PATCH` al entrar o salir de `done`, y reordenar con `status`: `soltar en cada
      columna…`.
    - Descompletar sin `grant_id`: `completar y descompletar sin señal…`, `soltar en cada columna…`,
      `descompletar una tarea migrada…`.
    - Concesión fija: `los ids nacen una sola vez…`. Día al sincronizar: `completar conserva el día…`.
    - Vista sin ordenar y sin desempate: `la vista sale en el orden del tablero…`.
    - Rechazado superpuesto: `un 409 de completar…`, `lo rechazado no se superpone…`.
    - Vista sin la concesión: `completar y descompletar sin señal…`.
    - Completar lo hecho, concesión vieja que reabre, columna ignorada y `PATCH` que saca de `done`:
      su test `… igual que el servidor` o `descompletar lleva a la columna…`.
    - Otros recursos en cada vista (tareas, hábitos, proyectos): `cada vista ignora…`.
    - Borrar proyecto sin soltar tareas: `borrar un proyecto…`.
    - Conteos viejos, ítem en posición 0 y borrar ítem sin efecto: `la checklist pendiente se ve…`;
      posición 0 también tumba `un proyecto, una tarea…` y, en cascada, el test siguiente.
    - Proyecto nuevo al final: `crear, editar y borrar un proyecto…`.
    - Sin persistir tareas o proyectos: `las tareas sobreviven al arranque…`.
  - **Límites para la 2.2.5** (resueltos ahí):
    - Una tarea del historial descompletada sin conexión sale de `useTaskHistory` al instante, pero
      solo entra a `useTasks` al sincronizar.
    - Los conteos `tasks_total` y `tasks_pending` no se predicen.
    - El toast de sincronización de `context.tsx` dice «marcas» también para tareas completadas.
- **`android:allowBackup="false"`** (2026-10-31, Bogotá): el APK de debug lo lleva (`aapt`). **Falta
  instalarlo y abrirlo en el teléfono:** `adb devices` no mostró ninguno.
- **2.2.5** (2026-10-31, Bogotá):
  - **Pendientes de la 2.2.4, resueltos:**
    - **Historial sin conexión:** la request de descompletar lleva una copia de la tarea
      (`ApiRequest.snapshot`). No viaja al servidor, pero sobrevive a reiniciar, y por eso la tarea
      entra a la lista al instante.
    - **Conteos de proyectos:** los del servidor más la diferencia que hace la cola sobre la lista.
      No se cuentan desde cero, porque el servidor también cuenta completadas que la lista no trae.
    - **Toast:** «2 marcas · 1 tarea · +35 XP».
  - **Mover con el dedo:** cada tarjeta del tablero tiene un botón «Mover» visible, que abre la hoja
    de la decisión 9 (columna, subir, bajar). En táctil (`pointer: coarse`) el arrastre HTML5 se
    apaga, para no pelear con el scroll; con ratón sigue igual. En teléfono se ve una columna a la
    vez, con `Segmented`.
  - **Adaptaciones:** bajo `lg:` hay filtros plegados y una sola fila de botones. Tocar el texto de
    una tarea abre el formulario, que también borra. Los proyectos van al final, en una columna.
    Las etiquetas de la banda de vencimientos son más angostas, y al tocarlas dicen la lista completa
    del día (en la v1 era un `title`). Fuera, como dice el plan: pomodoro y nota del vault; también
    `h foco`, que llega con Pomodoro (fila 22).
  - **Sin agregar a `DESIGN_SYSTEM`:** `Field` es un `<label>`, así que un botón adentro se activa
    al tocar el rótulo. La hoja «Mover» y la checklist usan un rótulo simple por eso. Los chips de
    `TagInput` siguen dentro de un `Field`, igual que en Hábitos y en la v1.
  - **Lo que solo salió al mirar:** el rótulo «Orden» activaba «Subir» (lo delató Playwright);
    «Hecho» cortado en las pestañas; etiquetas de la banda pisándose en el teléfono; el botón de
    completadas antiguas saliéndose de la tarjeta; y el aviso de React por `borderLeft` junto a
    `borderColor`, que venía de la v1.
  - **Recorrido en navegador** contra `wrangler dev` con D1 aparte y datos inventados:
    - **Contexto táctil móvil** (`hasTouch`, `pointer: coarse`, 393 × 852), 0 tarjetas `draggable`:
      bajar, pasar a En curso y a Hecho con la hoja salió como `PATCH`, `PATCH` y `complete`.
    - **Sin conexión:** completar, reabrir, completar y reabrir otra no mandaron nada; la cabecera
      dijo «4 sin sincronizar» y al volver salieron en orden.
    - **Historial sin conexión:** la tarea entró a la lista y Tesis pasó a 1/4, lo mismo que dio
      el servidor (4 en total, 3 pendientes). XP final 35, igual a la cuenta a mano.
    - **Ratón a 1280 × 800:** arrastrar a otra tarjeta y a la columna Hecho salió como `PATCH` con
      `rank` y `complete` con `rank`. Toast real: «1 tarea · +15 XP».
    - La sin conexión se simuló con el navegador; `@capacitor/network` sigue sin probarse en modo
      avión. **El dedo en un teléfono real y la tablet tampoco se han probado.**
  - **Vista contra el worker real:** el test temporal de la 2.2.4 ahora también compara
    `tasks_total` y `tasks_pending` en sus 23 escrituras, y coincide en todas.
  - **Mutaciones:** caen las 13 nuevas, con los tests de `tasks.test.ts` de cada pendiente, de
    `sortTasks`, `stepNeighbours` y el recordatorio. Una 14.ª (un rechazo del historial contado en
    los conteos) sobrevivió y se le agregó test; **no se volvió a correr esa mutación tras agregarlo.**
  - **El worker no cambió** desde `4c0f549` (versión `e48ada2d`): esta tarea no necesita deploy. La
    vista llega en el APK.
  - **Prueba en el teléfono** (2026-10-31, Bogotá; Infinix X6831, contra producción). El APK se
    instala encima del anterior y abre; `dumpsys package` ya no lista `ALLOW_BACKUP`. Johan reporta
    que hizo el recorrido. D1 después:
    - **XP:** `users.xp` = 969 = suma de `xp_log`.
    - **Primera tarea:** completada y descompletada con la misma concesión (+15 y −15, 7 s después)
      y luego borrada: ya no está en `tasks`.
    - **Segunda tarea:** en `done`, con su concesión vigente, `rank` `V`, en su proyecto (1 de 1
      hecha). `completed_on` es 2026-10-31 con `completed_at` 2026-11-01T04:27Z: el día local
      correcto. El `id` de la concesión (UUID v7) dice que se tocó a las 04:27:45 y el servidor la
      recibió a las 04:27:55: 10 s en cola, compatible con el modo avión.
    - **Sin rastro en D1:** `checklist_items` está vacía y los `PATCH` de mover no dejan historial.
      Si hubo subtareas, se pudieron borrar a mano o con la tarea (`ON DELETE CASCADE`). Esos dos
      pasos quedan solo con el reporte de Johan.
    - Quedan en producción 1 tarea y 1 proyecto de prueba. Se borran al vaciar la base (fase 4).
- **2.2.6** (2026-11-01, Bogotá; Infinix X6831, Android 13, XOS, contra producción):
  - **Contrato:** `extra.kind`, ids de tareas desde 1 000 000 y nada de `cancelAll` (comentario de
    `reminders.ts` y ADR 0003). El `extra` lleva además `remindAt`: `getPending` devuelve la hora
    como texto de Java (`Sat Oct 31 23:47:00 GMT-05:00 2026`), así que no se compara `schedule.at`.
  - **`getPending` devuelve también lo ya disparado:** el plugin guarda el registro hasta que se
    descarta. Por eso una alarma con hora pasada y sin cambios se deja como está: ni se reagenda ni
    se cancela.
  - **Sin conexión:** la reconciliación usa la lista con la cola encima, así que completar sin señal
    cancela al instante.
  - **XOS retiene la alarma si Grimoire no tiene el inicio automático.** Con la app cerrada,
    Android dispara la alarma a su hora, pero la entrega nunca termina: queda `InFlight` y no hay
    `Start proc` ni notificación.
    - **Sin el ajuste:** 2 de 2 no sonaron. Una cerrada con `am kill` y otra desde Recientes
      (`Killing … remove task`).
    - **Con Johan activándolo en Phone Master («Inicio automático»), no leído por `adb`:** el proceso
      muerto a las 00:47:40 arrancó con `Start proc … for broadcast`, y sonó. La prueba anterior a
      esa no cuenta: el proceso seguía vivo.
    - **Hay 1 caso a cada lado de cada condición, no una estadística.** El log no muestra un bloqueo
      explícito para Grimoire. `Griffin/ComponentManager: Limit start proc` sí aparece para otras 12
      apps al arrancar, y por eso es el sospechoso, sin confirmar. **Sin explicar:** en la 0.4 sonó
      con la app cerrada desde Recientes, sin este ajuste anotado.
    - No se puede leer ni activar desde la app. El formulario lo recuerda al poner una hora.
    - **Sin probar:** si el ajuste sobrevive a reinstalar el APK.
  - **Retraso:** con el ajuste, el recordatorio de las 00:50:00 se entregó a las 00:52:28, aunque la
    alarma era exacta (`window=0`) y la pantalla estaba bloqueada. Causa desconocida y un solo caso:
    a la 01:33 no se midió el retraso. Pomodoro depende de esto, así que **hay que medirlo allá.**
  - **Reinicio: sobrevive.** `LocalNotificationRestoreReceiver` está registrado para
    `BOOT_COMPLETED` y arrancó a la 01:30:13 sin abrir la app, y «Prueba rec A» sonó a la 01:33 (Johan).
    Lo vencido sin entregar **no** se recuperó: «Prueba rec B», retenida a las 00:26, siguió sin
    sonar tras el reinicio. Coincide con la regla de no disparar lo pasado.
  - **Recorrido en el teléfono**, comprobando alarmas con `dumpsys alarm`:
    - Agendar: exacta, `window=0`.
    - Editar la hora: mismo id, y la alarma vieja desaparece.
    - Completar: se cancela.
    - Reabrir: se reagenda.
    - Quitar la hora: se cancela.
    - Las demás tareas no se tocaron en ninguno de esos pasos.
    - La primera vez, el script de prueba editó otra tarjeta y pareció una alarma duplicada; no era
      un fallo de la app.
  - **Mutaciones:** caen las 23 (`reminders.test.ts` y el test de Bogotá en `tasks.test.ts`), incluidas
    otro `kind` tocado, `cancelAll`, colisión sin resolver y hora pasada agendada.
  - **Sin probar:** `notificationAccess` en Android 14+ (pendiente de la tablet, 0.4): el teléfono es
    API 33 y tiene la alarma exacta concedida, así que el aviso de la vista no se ha visto en
    pantalla. La rama web tampoco se probó en un navegador real.
  - **Sin deploy:** el worker no cambió. XP en producción: 969 = suma de `xp_log`. Quedan «Prueba rec
    A» a «E» en producción, sin alarmas futuras; se borran al vaciar la base (fase 4).
