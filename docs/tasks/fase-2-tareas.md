# Fase 2.2 — Tareas de punta a punta

**Estado: plan propuesto, pendiente de aprobación de Johan. Sin código del módulo todavía.**

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

Las 1, 2, 4, 5 y 6 las fijó Johan al pedir este plan (2026-10-31); aquí se concretan. La 3 y de
la 7 en adelante son propuestas.

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
3. **`remind_at` entra el día 1 como notificación local, propuesta.** Va al final (2.2.6) y no
   bloquea lo demás.
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

## Diferencias propuestas con la v1

Al aprobarlas pasan a «Diferencias permitidas» de `caracterizacion-v1.md`, como filas 11 en
adelante. También aplica la fila 4 (todos los logros desbloqueados en la respuesta).

| # | Diferencia | v1 (golden) | v2 | Motivo |
|---|---|---|---|---|
| A | XP al descompletar | Suma todas las concesiones históricas (`descompletar_piso`: −30 de 15) | Solo la concesión vigente | Es un bug: quitaba XP legítimo. |
| B | `PATCH` y `done` | Cambia `completed` sin XP; repetir ciclos paga de nuevo (`kanban_estado`) | 422; solo por `complete`/`uncomplete` | La UI nunca lo usó sin llamar antes a `complete`. Decisión 7. |
| C | Crear con `status: done`, `PATCH completed` | Estados contradictorios | 422; `completed` no se acepta | Decisión 7. |
| D | Orden | `position` entera; mover reescribe la columna | `rank`; mover escribe una fila. Tarea nueva: al final de su columna | Decisión 1. |
| E | Repetir `DELETE` | 404 | 204 | Contrato de la cola. Decisión 6. |
| F | Regla rechazada (ya completada, no completada) | 400 | 409, o 200 sin efecto si es el mismo id | 409 como en Hábitos. Decisión 2. |
| G | `project_id` inexistente | 201 | 422 | Con la clave foránea, una referencia rota fallaría igual. La cola mantiene el orden, así que crear proyecto y tarea sin conexión funciona. |
| H | Checklist: texto vacío | 201 | 422 en la API, sin `CHECK`, por si la migración trae vacíos | Es un ítem que no dice nada. |
| I | Checklist: `PATCH position` y `GET /tasks/{id}/checklist` | Existen; un id inexistente da 200 con `[]` | No existen; la checklist viene en la tarea | La UI de la v1 no reordena ni usa esa lectura sola. |
| J | Filtro `tag` | Subcadena en el servidor (`a` trae `casa`) | Token exacto sin distinguir mayúsculas, en el cliente | Es un falso positivo. Igual que Hábitos: filtro en el cliente. |
| K | Lista de etiquetas del filtro | `GET /tags`: hábitos, tareas y diario | Derivada de las tareas cargadas | Sin ruta nueva; módulo de etiquetas en la fase 5+. |
| L | `pomodoro_hours` | En cada proyecto | Llega con Pomodoro | Aún no hay sesiones. Su UI se oculta hasta entonces. |

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

- Rutas de checklist y proyectos, con el contrato de la cola.
- Medir la lista de proyectos con el mismo seed.
- `scripts/replay_golden.py`: reproduce los 8 goldens contra `wrangler dev`. Traduce alias a UUID,
  genera `id`, `rank` y concesiones, y compara status y campos. Hace falta porque buena parte de
  estos goldens es CRUD del worker, que el dominio no ve. Cada campo omitido cita su diferencia.

Terminado: los 8 goldens reproducidos sin diferencias fuera de la tabla. Salida en «Hallazgos».

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
