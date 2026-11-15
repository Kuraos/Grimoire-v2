# Fase 2.4 — Diario de punta a punta

**Estado: plan aprobado por Johan el 2026-11-14.**

Depende de: la cola sin conexión (2.1.6, ADR 0008), Hábitos y Pomodoro (el resumen del día lee sus
marcas y sesiones) y la caracterización de la v1 (`docs/tasks/caracterizacion-v1.md`).

Objetivo: que el Diario funcione en la v2 como en la v1, con las diferencias de la tabla de abajo y
nada más, y que **ningún texto escrito se pierda**, ni sin conexión ni escribiendo desde dos
dispositivos. Es el último módulo del mínimo para dejar la v1 (`ROADMAP.md`).

Cada tarea es una sesión de agente. Al terminar: verificación de `AGENTS.md` en verde, un commit
por tarea (`fase-2: <tarea>`) y una línea en «Hallazgos» si apareció algo. Si una tarea revela que
una decisión no se sostiene, se para y se anota, en vez de rodearla.

---

## Lo que hace la v1

`backend/routers/diary.py` (226 líneas) y `frontend/src/pages/Diary.tsx` (211):

- Una entrada por día (`entry_date` único), texto Markdown y etiquetas separadas por comas.
- `GET /diary/{date}` no crea filas (bug arreglado: inflaba «Archivista»). `PUT` hace upsert.
- **5 XP una sola vez por entrada**, la primera vez que se guarda con texto: vaciarla y reescribirla
  no paga de nuevo (`xp_log` es la fuente de verdad).
- Logros: `archivist` (30 entradas) y `diary_century` (100).
- Búsqueda con `LIKE` escapado (un `%` no devuelve todo), `GET /diary/dates` para las marcas del
  minicalendario, `GET /diary/volume` para el gráfico, y `GET /diary/{date}/summary`: hábitos
  marcados, sesiones y minutos de pomodoro, XP del día y check-in.
- Autoguardado a los 30 s de la última tecla, al salir del campo y al cambiar de día (`useAutoSave`).
- Vista previa de Markdown (`renderMarkdown`, ya en `app/src/utils.ts`, escapa antes de formatear).
- Exportar a Obsidian: escribe `{vault}/06-Diario/{fecha}.md` desde el backend.

**Una incoherencia de la v1:** el XP exige `content.strip()` no vacío, pero los conteos (logros,
marcas, búsqueda, misiones) usan `content != ""`. Una entrada de solo espacios cuenta para
«Archivista» sin haber pagado XP.

---

## Decisiones

La 1, la 3 y la 9 las fijó Johan el 2026-11-14. Las demás las propuso el plan, y Johan las aprobó con él.

1. **Ningún guardado pisa un texto que el dispositivo no vio.** El caso real: el PC
   escribió la entrada de hoy, y el teléfono abre el Diario sin señal y sin esa entrada en caché. El
   editor sale vacío, se escribe, y al volver la señal el `PUT` reemplaza lo del PC. Con dos
   dispositivos escribiendo el mismo día pasa lo mismo.
   - Cada guardado lleva `save_id` (UUID del cliente) y `base_save_id`: el `save_id` de la versión
     sobre la que se escribió (`null` si el dispositivo no conocía ninguna). La entrada guarda el
     `save_id` vigente.
   - En el servidor, función pura del dominio:
     - `save_id` igual al vigente → repetición: 200 sin efecto (contrato de la cola).
     - `base_save_id` igual al vigente, o no hay entrada → se guarda.
     - Si no → **conflicto: gana lo que llega**, y el texto que se iba a pisar se copia a
       `diary_conflicts` (fecha, texto, etiquetas, `save_id`, hora). No se pierde nada y la cola
       no se bloquea.
   - La vista avisa en ese día: «Otra versión de este día quedó guardada aparte», con ver, copiar al
     final de la entrada o descartar. Descartar borra la copia.
   - Varios guardados en cola encadenan su base (`base` del segundo = `save_id` del primero), así que
     escribir sin señal en un solo dispositivo nunca da conflicto.
   - Se descartó «gana el último» de la v1: en el caso de arriba borra texto en silencio.

2. **El texto se guarda en el dispositivo antes que en la cola.** Cada tecla actualiza un borrador
   local (`@capacitor/preferences`, por fecha, con espera de 1 s), y se encola un `PUT` con el texto
   completo en los mismos momentos que la v1 (30 s sin teclear, salir del campo, cambiar de día) y
   además **al pasar la app a segundo plano** (`App.addListener('pause')`): en Android el sistema puede
   matarla ahí. El borrador se borra cuando su `PUT` se confirma.
   - Cada `PUT` es idempotente y completo; varios en cola se aplican en orden y gana el último.
   - `ponytail:` sin fusionar `PUT` pendientes. Una hora escribiendo sin señal son ~120 copias del
     texto en la cola (~1 MB con 10 KB por entrada). Si pesa, se reemplaza el último pendiente de la
     misma fecha.

3. **Lectura sin conexión: las entradas de los últimos 7 días que se abrieron quedan en el
   dispositivo.** Con `allowBackup="false"` (ADR 0008) no salen a Google Drive. Se descartó no
   guardar texto: sin señal, el editor saldría vacío y todo dependería de la decisión 1.

4. **Un día está escrito si `trim(content)` no queda vacío**, en todo: XP, logros, marcas, volumen y
   búsqueda. Arregla la incoherencia de la v1 (fila 35).

5. **5 XP una vez por entrada, en un solo `batch` condicionado**, como las demás concesiones:
   `xp_log.mark_id` = id de la entrada, y se paga solo si no existe ya esa concesión. `archivist` y
   `diary_century` solo cuentan mientras sigan bloqueados. No hay deshacer: la v1 no lo tiene.
   - El id de la entrada lo genera el cliente al crearla (invariante 2). Si dos dispositivos crean el
     mismo día, el segundo choca con `UNIQUE (local_date)`: el servidor conserva el id existente y lo
     trata como un guardado más (decisión 1). Una sola concesión por día.

6. **Cualquier fecha se puede escribir**, también pasadas y futuras, como en la v1. La columna es
   `local_date` (`YYYY-MM-DD`, invariante 3); `updated_at` en UTC.

7. **Rutas, menos que la v1:**
   - `GET /diary/{date}` devuelve la entrada **y** el resumen del día en una request (la v1 hacía dos).
     Sin entrada, `id: null` y no crea fila.
   - `PUT /diary/{date}` con `id`, `save_id`, `base_save_id`, `content` y `tags`. Responde XP, logros y
     si hubo conflicto.
   - `GET /diary/volume`: fecha y longitud de los últimos 12 meses (ADR 0007), más el total de
     entradas escritas. Alimenta el gráfico **y** las marcas del minicalendario, que en la v1 solo
     muestra el mes en curso. Reemplaza `GET /diary/dates` (fila 37).
   - `GET /diary/search?q=`: fecha y un fragmento de ~80 caracteres alrededor de la coincidencia, no
     el texto entero; las 50 más recientes (fila 38). Sin conexión no busca, y lo dice.
   - `DELETE /diary/conflicts/{id}` (decisión 1). Repetir el `DELETE` da 204, así que cumple el
     contrato de la cola. Las copias del día llegan con `GET /diary/{date}` (cambio de la 2.4.3: sin
     `GET /diary/conflicts/{date}`).

8. **Resumen del día sin check-in.** Hábitos marcados (`local_date`), sesiones y minutos completos
   de pomodoro (`local_date`) y XP del día. El XP no tiene `local_date`: se leen las filas de `xp_log`
   de un día antes a un día después, y el día local de cada una lo decide la zona configurada (2.4.3).
   La fila de energía y ánimo no se muestra hasta que lleguen los check-ins (fila 36).

9. **Sin exportación a Obsidian.** El diario vive solo en la app, no en el vault. La ruta
   `export-obsidian` de la v1 no se porta, ni ahora ni en la fase 5+, y sale de «Después del cambio»
   en `ROADMAP.md`. Las notas de `06-Diario/` que ya exportó la v1 quedan donde están; la migración
   (fase 4) trae las entradas desde la base de la v1, no desde el vault.

10. **Límite de tamaño: 200 000 caracteres por entrada** (422 por encima). La v1 no tiene; una entrada
    real es de 1–20 KB, y D1 admite filas mucho mayores.

---

## Diferencias con la v1

Se agregan a «Diferencias permitidas» de `caracterizacion-v1.md` al aprobar el plan. También aplica la
fila 4 (todos los logros desbloqueados en la respuesta).

| # | Diferencia | v1 | v2 | Motivo |
|---|---|---|---|---|
| 35 | Qué es una entrada escrita | XP con `strip()`; conteos con `!= ""` | `trim` no vacío en todo | Decisión 4. Una entrada de espacios desbloqueaba «Archivista». |
| 36 | Check-in en el resumen | Energía y ánimo del día | No se muestra | Los check-ins llegan en la fase 5+. Los datos se migran igual. |
| 37 | `GET /diary/dates` | Todas las fechas con entrada | No existe: las marcas salen de `GET /diary/volume` (12 meses) | El minicalendario solo muestra el mes en curso. |
| 38 | Búsqueda | Texto completo de todas las coincidencias | Fragmento; las 50 más recientes | No mandar el diario entero por la red, y respuesta acotada. |
| 39 | Guardar sobre una versión que el dispositivo no vio | Gana el último | Gana el último y lo pisado se guarda aparte | Decisión 1. Ningún golden lo cubre: la v1 tiene un solo cliente. |
| 40 | Repetir el `PUT` | Idempotente por contenido | Idempotente por `save_id`; `PATCH` no existe | Contrato de la cola (ADR 0004). |
| 41 | Exportar a Obsidian | `POST /diary/{date}/export-obsidian` | Se elimina | Decisión 9, de Johan: el diario es de la app, no del vault. |
| 42 | Tamaño de la entrada | Sin límite | 422 sobre 200 000 caracteres | Decisión 10. |
| 43 | Día del XP en el resumen | El de la concesión, que es siempre «ahora» | El de la concesión, que en la v2 puede ser posterior al día marcado: una marca tardía (ventana de gracia) o una escritura sincronizada al día siguiente | Salió en la 2.4.3; `xp_log` no guarda `local_date`. Solo cambia el «XP ganado» del resumen. |

---

## Alcance: la v1 frente a la v2

| v1 | v2 | Nota |
|---|---|---|
| `GET /diary/{date}` + `/summary` | `GET /diary/{date}` con resumen | Decisión 7. |
| `PUT`/`PATCH /diary/{date}` | `PUT` | Con `save_id` y `base_save_id`. |
| `GET /diary/dates`, `/volume` | `GET /diary/volume` | Fila 37. |
| `GET /diary/search` | igual, con fragmento | Fila 38. |
| `export-obsidian` | no | Fila 41. |
| `useAutoSave` | se porta, con borrador local | Decisión 2. |
| `DiaryVolume`, `MiniCalendar`, `TagInput`, `renderMarkdown` | ya portados | `DiaryVolume` espera `points` (su `TODO`). |

Fuera de alcance: la misión `weekly_diary_3` (llega con Misiones; la tabla ya tiene lo que necesita),
`GET /tags` (fila 21) y check-ins.

### Contrato con la cola

| Ruta | Repetirla da |
|---|---|
| `PUT /diary/{date}` | 200 sin efecto: el `save_id` ya es el vigente. |
| `DELETE /diary/conflicts/{id}` | 204: ya no existe. |

---

## 2.4.1 — Caracterización de la v1

`scripts/characterize_v1.py` con escenarios nuevos en `api/crates/domain/tests/golden/diary/`:

- `xp_una_vez`: escribir, vaciar, reescribir: 5 XP una sola vez.
- `get_no_crea`: tres `GET` de fechas vacías no crean filas.
- `solo_espacios`: entrada de espacios: 0 XP, pero cuenta (fila 35).
- `logros_diario`: 30 y 100 entradas desbloquean `archivist` y `diary_century`.
- `busqueda`: `%` literal, sin entradas vacías, de la más reciente a la más antigua.
- `etiquetas_y_validacion`: etiquetas conservadas o borradas, y rechazos 422.
- `resumen_dia`: hábitos, sesiones, minutos y XP de un día con datos de los tres módulos.

Datos inventados, como siempre: nada del diario real.

Terminado: goldens commiteados y filas 35 a 42 en `caracterizacion-v1.md`.

## 2.4.2 — Esquema y dominio

- Migración `0007`: `diary_entries` (`id`, `local_date` único, `content`, `tags`, `save_id`,
  `updated_at`) y `diary_conflicts` (`id`, `local_date`, `content`, `tags`, `save_id`, `created_at`),
  con índice por `local_date`.
- Dominio puro (`diary.rs`): «está escrita» (decisión 4), la decisión de guardado (repetición,
  guardar, conflicto) a partir de lo leído, el fragmento de búsqueda (sin partir un carácter UTF-8) y
  `earned_on_diary` con el conteo ya calculado. 5 XP desde `xp.rs`.
- `tests/golden_diary.rs` reproduce `xp_una_vez`, `solo_espacios` y `logros_diario`. Cada campo que no
  se compara cita su fila.

Terminado: goldens de regla en verde, con las diferencias marcadas una por una.

## 2.4.3 — API

- Las cinco rutas de la decisión 7. `PUT` en un solo `batch` condicionado: el `UPDATE` exige el
  `save_id` leído, y si otro guardado ganó en medio, se relee y se decide otra vez.
- Tests contra SQLite (`grimoire-worker`):
  - Dos `PUT` con el mismo `save_id` a partir del mismo estado: una escritura y una concesión.
  - Dos `PUT` de dispositivos distintos con la misma base: uno guarda y el otro deja un conflicto;
    ningún texto se pierde.
  - Dos dispositivos crean el mismo día con ids distintos: una fila y una concesión.
  - `users.xp` sigue siendo la suma de `xp_log`.
- `scripts/replay_golden.py` traduce los escenarios del diario y compara contra `wrangler dev`.
- Medir CPU de `PUT` con 20 KB, `GET /diary/{date}`, `GET /diary/volume` y la búsqueda con 1 000
  entradas sintéticas de 2 KB. Deploy y `0007` en remoto, solo cuando Johan lo pida.

Terminado: goldens contra `wrangler dev` con cada escritura repetida. Mediciones en «Hallazgos».

## 2.4.4 — Capa de datos

- `app/src/api/diary.ts`: `diaryRequests` (puras), hooks y `applyQueue` (la vista muestra lo que hay
  en cola sobre lo leído). `syncedSummary` agrega «Diario · +5 XP» al toast solo cuando hubo concesión.
- Borrador local y autoguardado (decisión 2), sobre `useAutoSave` portado.
- Caché de 7 días (decisión 3), si se aprueba.
- Tests con arranques simulados, como `queue.test.ts`:
  - Escribir sin conexión, cerrar la app y abrir: el borrador sigue y el `PUT` sale una vez.
  - Pasar a segundo plano encola lo pendiente.
  - Cambiar de día guarda el anterior antes de cargar el siguiente.
  - Tres guardados en cola encadenan su base.
  - Un conflicto en la respuesta deja el aviso en ese día.
- Comprobar con mutaciones que los tests no pasan en vacío, registrando qué test cae en cada una.

Terminado: `npm run typecheck && npm test && npm run build` en verde.

## 2.4.5 — Vista Diario

Portar `frontend/src/pages/Diary.tsx`, según `docs/DESIGN_SYSTEM.md`. En el repo ya están `Card`,
`PageHeader`, `MiniCalendar`, `TagInput` y `DiaryVolume`. No se crean componentes salvo justificación
en el commit.

- Mobile-first con el layout de la v1 (1,9 : 1) en `lg:`. En teléfono, el editor ocupa el ancho y el
  resumen, el calendario, la búsqueda y el volumen van debajo.
- El `text-[17px]` y el `min-h-[340px]` de la v1 pasan a la escala.
- En teléfono, el teclado no tapa el cursor ni la barra de estado del guardado.
- Aviso de conflicto (decisión 1) y de «sin conexión» en la búsqueda.

Terminado: capturas a 393 × 852 y 1280 × 800 de edición, vista previa, conflicto y búsqueda,
revisadas.

## 2.4.6 — Prueba en el teléfono

Johan, con el Infinix y contra la API desplegada (el deploy lo hace o lo autoriza él):

- Escribir con la app abierta, cerrarla de golpe a los 10 s: al abrir, el texto sigue.
- Modo avión: escribir, cerrar, abrir, volver la señal: un solo guardado y +5 XP una vez.
- Escribir hoy en el PC; en el teléfono sin señal y sin caché, escribir el mismo día: al sincronizar,
  aviso de conflicto y los dos textos recuperables.
- Escribir con el teclado abierto en la tablet horizontal.

Terminado: **se consulta D1 antes de darlo por bueno**: una fila por día, `users.xp` = suma de
`xp_log`, una concesión por entrada y las copias de conflicto esperadas.

---

## Migración

Se agrega al ADR 0006 al cerrar el módulo: `entry_date` → `local_date`; `updated_at` naive de Bogotá
a UTC; `save_id` nuevo por entrada; las filas vacías o de solo espacios se deciden al ver los datos
reales (decisión 4); el XP histórico se copia con `mark_id` = id nuevo de la entrada, para que
reescribir una entrada migrada no pague de nuevo.

---

## Hallazgos

- **2.4.1, caracterización** (2026-11-14): 7 escenarios, 208 pasos, v1 en `f85381f`. Los 21 goldens
  anteriores salieron idénticos al regenerar. Lo nuevo, en «Hallazgos» de `caracterizacion-v1.md`:
  `GET /diary/dates` no ordena, la búsqueda no pliega tildes (`café` no encuentra `CAFÉ`; la v2 hereda
  lo mismo de SQLite si no se decide otra cosa en la 2.4.2), las etiquetas se guardan sin normalizar y
  el XP del día del resumen incluye el del check-in.

- **2.4.2, esquema y dominio** (2026-11-14):
  - **`diary_entries.written`**, columna que no estaba en el plan. La calcula `diary::is_written` al
    guardar, y los conteos (logros, marcas, volumen, búsqueda) filtran por ella. Con SQL no se puede:
    `trim()` de SQLite solo quita espacios, y `"   \n\t "` contaría como escrita. Índice
    `(written, local_date)`: el volumen de 12 meses es un `SEARCH` por índice.
  - **`diary_conflicts.id` = `save_id` del guardado que la causó**, sin generar un UUID en el servidor:
    cada guardado causa a lo sumo una copia, y repetirlo no la duplica.
  - **`decide_save` no marca conflicto si no hay nada que perder:** si lo vigente no está escrito o es
    igual a lo que llega, se guarda sin copia.
  - **Límite conocido** (`ponytail:` en `decide_save`): solo se recuerda el último `save_id`. Si un
    guardado ya aplicado se repite después de que otro dispositivo escribió encima, se toma por
    conflicto y vuelve el texto viejo; el nuevo queda en `diary_conflicts`. No se pierde nada.
  - **Búsqueda sin plegar tildes, como la v1:** `like_pattern` y `snippet` buscan igual que `LIKE`
    (mayúsculas solo en ASCII). Plegar en Rust obliga a leer todas las entradas en el worker.
  - `tests/golden_diary.rs` reproduce 6 escenarios; `resumen_dia` queda para la 2.4.3.
  - **Mutaciones** (la suite de `grimoire-domain` con cada una; el archivo se restaura después):

    | Mutación | Tests que caen |
    |---|---|
    | Escrita sin `trim` | `written_means_text_after_unicode_trim`, `nothing_to_lose…`, `xp_once…`, `solo_espacios` |
    | Pisar texto vacío es conflicto | `nothing_to_lose_is_not_a_conflict` |
    | Paga en cada guardado | `xp_once…`, `xp_una_vez`, `logros_diario`, `etiquetas_y_validacion` |
    | Sin escapar `%` ni `_` | `like_pattern_escapes_wildcards_and_the_escape` |
    | `archivist` en 31 | `logros_diario` |
    | Fragmento sin contexto previo | `long_text_is_cut_around_the_match_on_char_boundaries` |
    | Sin reintento | `same_save_id…` y los 6 goldens |
    | Base ignorada | `writing_on_the_current_version…`, `xp_una_vez`, `logros_diario`, `etiquetas_y_validacion` |

  - Verificación: `fmt`, `clippy -D warnings`, `grimoire-domain` (21 unitarios + goldens) y
    `grimoire-worker` (28) en verde. Las 7 migraciones aplican en SQLite, con `UNIQUE` y `CHECK`
    comprobados. El worker todavía no incluye la `0007` en sus tests: llega con la 2.4.3.

- **2.4.3, API** (2026-11-14):
  - **Rutas:** `GET` y `PUT /diary/{date}`, `GET /diary/volume`, `GET /diary/search` y
    `DELETE /diary/conflicts/{id}`. `PUT` se agregó al CORS (`Access-Control-Allow-Methods`): sin eso,
    la APK no puede guardar.
  - **Cambio frente al plan:** las copias en conflicto llegan con `GET /diary/{date}`, no en una ruta
    propia. `PUT` responde `conflicts`, el número de copias del día, y no si este guardado causó
    una: así un reintento responde lo mismo.
  - **`PUT` en un solo `batch` condicionado al `save_id` leído.** Si otro guardado ganó en medio, nada
    se escribe y se relee, hasta 3 veces; después, 409. La copia del conflicto, el XP y los logros
    exigen que la entrada quede con este `save_id`.
  - **XP del día sin suponer la zona:** se leen las filas de `xp_log` de un día antes a uno después
    (índice nuevo `xp_log_created` en la `0007`, que aún no se aplicó en remoto) y `local_date_of`
    decide el día de cada una.
  - **Fila 43, nueva y pendiente de aprobar:** el XP cuenta el día en que se concedió. Una marca
    tardía, o lo que se sincroniza al día siguiente, suma su XP al día en que llegó.
    En `resumen_dia`, la marca de ayer suma 20 a hoy.
  - **Tests contra SQLite** (`grimoire-worker`, 8 nuevos): el mismo `save_id` desde el mismo estado
    escribe y paga una vez; dos dispositivos sobre la misma base no pierden texto; dos que crean el
    mismo día dejan una fila con el primer id y una concesión; vaciar y reescribir no paga;
    etiquetas; escritas sin espacios; búsqueda con comodines; ventana del volumen.
  - **Goldens contra `wrangler dev`** (base local nueva, token desechable), cada escritura repetida:
    los 7 escenarios del diario en verde, y los de Tareas y Pomodoro siguen igual. `resumen_dia` se
    traslada a hoy (ventana de gracia de las marcas) y el hábito se crea con fecha del escenario por
    SQL.

    | Escenario | Pasos | Reintentos | Diferencias permitidas |
    |---|---|---|---|
    | `busqueda` | 15 | 6 | 38 (×9) |
    | `etiquetas_y_validacion` | 15 | 5 | 40 |
    | `get_no_crea` | 8 | 1 | 37, 38 |
    | `logros_diario` | 108 | 101 | — |
    | `resumen_dia` | 14 | 4 | 36 (×2), 43 (×2) |
    | `solo_espacios` | 37 | 30 | 35 (×2), 37, 38 |
    | `xp_una_vez` | 11 | 6 | 37 |

  - **Conflictos contra `wrangler dev`**, a mano: guardar sin base sobre texto ajeno deja una copia
    con id = el `save_id` que la causó, repetirlo no la duplica, un guardado encadenado no crea otra,
    el `DELETE` repetido da 204 y el XP queda en +5. Pasan 200 000 caracteres con tilde (400 000 bytes),
    y 200 001 da 422.
  - **Filas leídas y escritas** con `wrangler dev` y `scripts/bench_seed_diary.py` (1 000 entradas de
    2 000 caracteres, una por día). El tiempo local no es CPU:

    | Request | n | Filas leídas | Filas escritas | Wall local (mediana) | Respuesta |
    |---|---|---|---|---|---|
    | `GET /diary/{date}` | 11 | 6 | 0 | 11 ms | 2,3 KB |
    | `GET /diary/volume` | 11 | 1 345 | 0 | 14 ms | 14,5 KB |
    | `GET /diary/search`, 50+ coincidencias | 11 | 50 | 0 | 16 ms | 6,4 KB |
    | `GET /diary/search`, ninguna | 11 | 1 000 | 0 | 20 ms | 2 B |
    | `PUT`, 20 KB | 11 | 42 por guardado, más 1 000 la primera vez | 2 (12 la primera) | 19 ms | 20 KB |

    - `volume` lee 345 puntos y el `COUNT` de todas las escritas recorre el índice (1 000).
    - Una búsqueda sin coincidencias recorre todas las entradas. Con 1 000 son 1 000 filas; a 5 M
      diarias de D1 caben unas 5 000 búsquedas.
    - El `PUT` cuenta las escritas mientras `archivist` o `diary_century` sigan bloqueados. El seed no
      los desbloquea; con los datos reales migrados (backfill del ADR 0006) ya no cuenta.
  - **CPU en producción: pendiente**, como en Pomodoro: exige deploy y la `0007` en remoto, y eso solo
    cuando Johan lo pida.
  - Al cerrar: ningún `wrangler` ni `workerd` vivo y el 8787 libre.

- **2.4.4, capa de datos** (2026-11-14):
  - `app/src/api/diary.ts`:
    - `diaryRequests` arma `PUT` y `DELETE`.
    - `applyDiaryQueue` y `applyVolumeQueue` superponen la cola a lo leído.
    - Los borradores se escriben en disco con 1 s de espera, y `commitDiary` y `bootDiary` los encolan.
    - Hooks: `useDiaryDay`, `useDiaryVolume`, `useDiarySearch` y `useDiaryEditor`.
    - `ApiRequest` acepta `PUT`.
  - **Base de cada guardado:** el `save_id` del último guardado en cola de ese día (pendiente o
    exitoso), o el de lo leído si no hay ninguno. Uno rechazado nunca se aplicó y no cuenta.
  - **El editor carga una vez por día:** del borrador si hay, si no de lo guardado con la cola encima,
    y vacío sin conexión ni caché (`fetchStatus: paused`). Un refresco no pisa lo que se teclea.
  - **Guarda** a los 30 s sin teclear, al cambiar de día o salir de la vista, con `pause` de Capacitor
    o `visibilitychange` a `hidden`, y al cambiar etiquetas. El texto vigente va en un `ref` que se
    asigna al cargar y al teclear, no en el render. Si no, al cambiar de día la limpieza vería el día
    nuevo y no guardaría el anterior.
  - **`bootDiary`** corre en `TokenGate` después de `bootSync`, para que la base salga de la caché
    restaurada.
  - **Caché de 7 días** (`persistedQuery` en `sync.ts`): los días abiertos entre hoy−6 y hoy, y el
    volumen. La búsqueda no se guarda.
  - **Toast:** «1 entrada · +5 XP» cuando una entrada sincronizada tarde paga. Antes, un `PUT` del
    diario habría contado como «marca».
  - Los tipos `DiaryEntry` y `DaySummary` de la v1 se reemplazan por los de la API (sin `checkin`,
    fila 36).
  - **Tests** (`diary.test.tsx`, 9):
    - Un borrador sin guardar sale en un solo `PUT` tras dos reinicios.
    - Tres guardados sin señal encadenan su base.
    - Guardar lo mismo no encola.
    - La copia del PC aparece y descartarla la oculta.
    - La vista derivada, el volumen, la ventana de disco y el toast.
    - El editor guarda al cambiar de día, en segundo plano, a los 30 s y al cambiar etiquetas.
  - **Trampa de test:** `onlineManager` es de `@tanstack/query-core`, que `vi.resetModules` no
    reinicia. Un arranque anterior lo deja en línea, y el test del editor veía la cola vacía porque las
    escrituras salían y se olvidaban. Pasaba aislado y fallaba en la suite.
  - **Mutaciones** (la suite completa con cada una; el archivo se restaura después):

    | Mutación | Tests que caen |
    |---|---|
    | Base siempre nula | `tres guardados…`, `el teléfono sin caché…`, `el editor guarda…` |
    | Cuenta los guardados rechazados | `lo último en cola manda…` |
    | El arranque ignora los borradores | `escribir sin conexión y cerrar…` |
    | No borra el borrador | `escribir sin conexión…`, `guardar lo mismo…`, `tres guardados…` |
    | No guarda al cambiar de día | `el editor guarda…` |
    | Sin segundo plano (`resume` en vez de `pause`) | `el editor guarda…` |
    | Sin guardado por inactividad | `el editor guarda…` |
    | Manda etiquetas no tocadas | `lo último en cola manda…` |
    | Volumen sin `trim` | `el volumen suma…` |
    | Ventana de 8 días | `en disco van los días…` |
    | Una entrada cuenta como marca | `una entrada sincronizada tarde…` |
    | Etiquetas sin guardar al cambiar | `el editor guarda…` |

  - Verificación: `typecheck`, 207 tests y `build` en verde. `oxlint` no agrega avisos de tipos
    nuevos: un `set-state-in-effect` (hay 13 más en el repo) y el patrón de sonda de los tests de hooks.

- **2.4.5, vista Diario** (2026-11-14):
  - Se porta `frontend/src/pages/Diary.tsx` de la v1 con los componentes ya portados (`Card`,
    `PageHeader`, `MiniCalendar`, `TagInput`, `DiaryVolume`). Sin componentes nuevos: el aviso de
    conflicto y la tarjeta de búsqueda son funciones locales de la vista.
  - **Mobile-first:** una columna con la entrada primero (es la `rubric`), y el 1,9 : 1 de la v1 en
    `lg:`. `text-[17px]` y `min-h-[340px]` pasan a la escala: `.font-prose` (16 px, también evita el
    zoom al enfocar) y `min-h-80`.
  - **Adaptaciones táctiles, vistas en la captura y medidas en el navegador:**
    - Las celdas del minicalendario miden 44 px de alto en la base (densidad, no dibujo).
    - `TagInput` es un `label` atado a su campo con `htmlFor`: tocar la caja lo enfoca. Sin `htmlFor`
      apuntaba a la ✕ de la primera etiqueta, y tocar la caja la habría borrado.
    - La ✕ lleva `gr-tactil`.
    - `.input` mide al menos 44 px en teléfono, en la regla táctil de `index.css`. Afecta también los
      formularios de Hábitos y Tareas, que medían 40 px.
  - **Lo que solo salió al mirar las capturas:**
    - El fragmento de búsqueda empezaba a mitad de palabra («…é y apuntes», de «Café»).
      `diary::snippet` ahora salta lo que quede de la palabra cortada, sin pasar de la coincidencia.
      Tiene test, con la mutación comprobada.
    - Las listas de la vista previa no tienen viñetas. La v1 tampoco las tenía (`renderMarkdown` emite
      `<ul>` y el reset de Tailwind quita el estilo): se deja igual, por paridad.
  - **Fuera de lo porteado:**
    - El minicalendario muestra el mes del día elegido; en la v1 siempre era el mes en curso.
    - El buscador dice «Sin conexión» cuando la consulta queda en pausa.
  - **Capturas** (`docs/capturas/fase-2.4.5-*`), con datos inventados sembrados por la API:
    - En 393 × 852 táctil: edición con conflicto, resumen y calendario, vista previa, y búsqueda con
      volumen.
    - En 1280 × 800: la vista y el conflicto abierto.
    - Revisado en las capturas: una sola `rubric`, oro solo en su nudo y en la estrella de hoy, nada
      cortado y `scrollWidth` igual al ancho.
    - Sin errores en consola.
    - Tocar un resultado de búsqueda lleva a ese día.
  - **`wrangler dev` no vigila `crates/domain`:** tras cambiar `snippet` siguió sirviendo el wasm
    viejo hasta reiniciarlo.
  - Verificación: `fmt`, `clippy`, 130 tests de Rust, `typecheck`, 207 de la app y `build` en verde.
    Al cerrar, ningún `wrangler`, `workerd` ni `vite` vivo, y el 8787 y el 5173 libres.

- **2.4.6, prueba en el teléfono** (2026-11-14, noche de Bogotá; Infinix X6831, Android 13, contra
  producción. Johan tocó el teléfono y el agente leyó por `adb`, CDP y D1):
  - **Antes:** `fmt`, `clippy -D warnings`, `cargo test`, `typecheck`, 207 tests y `build` en verde.
    En remoto solo faltaba la `0007`. Bookmark de time travel antes de migrar:
    `00000051-00000002-00005124-ce97b7b2f7def305b6b3f4ff4ee1f29c`. Referencia: `users.xp` 1089 = suma
    de `xp_log` (74 filas).
  - **Migración y deploy, con el «sí» de Johan:** la `0007` se aplicó al primer intento. Worker
    `26b417b5` → **`feebc627-e311-4e38-8550-3631b2d8bfe5`**. Humo desde el WebView con su token: los
    `GET` de `/diary/{día}`, `/diary/volume`, `/diary/search`, `/habits`, `/tasks` y
    `/pomodoro/today` dan 200; `/health` 200 y sin token 401.
    - El plugin de almacenamiento seguro guarda el token serializado en JSON: leído con
      `internalGetItem` hay que hacerle `JSON.parse`, o todo da 401.
  - **Prueba 1, cerrar el proceso: falló y se corrigió.** Al pasar a segundo plano, el `PUT` se
    encola y el borrador se borra; la caché en disco se escribe 2 s después. Matar la app en ese
    intervalo la abría con la caché de antes del guardado, y el editor la tomaba sin volver a mirar el
    servidor. **Peor que el síntoma:** al salir, mandaba ese texto viejo con la base nueva
    (`currentView` ya traía el `save_id` del servidor) y el servidor lo aceptaba sin conflicto: se
    perdía el texto nuevo también en D1. En la prueba no llegó a pasar.
    - Corrección en `useDiaryEditor`: el editor recuerda la versión sobre la que se escribe (`base`)
      y si hay cambios sin encolar (`edited`). Sin cambios, una versión más nueva del servidor se carga;
      con cambios, el guardado lleva la base cargada y lo del servidor queda como copia (decisión 1).
      `commitDiary` se parte en `queueDiary` (síncrona, devuelve la base siguiente) y `settleDraft`.
    - 2 tests nuevos, los dos en rojo antes del arreglo. Mutaciones: quitar la adopción de la versión
      nueva tumba `la app muere tras guardar…`; quitar la base del editor tumba `escribir sobre la
      caché vieja…`.
    - Johan repitió la prueba con la APK nueva: el texto sigue.
  - **Prueba 2, modo avión:** un solo guardado y una concesión `diary` de +5 con `mark_id` = id de la
    entrada; `users.xp` 1089 → 1094 = suma de `xp_log`. No hay dónde ver el XP: el Inicio aún no está
    portado (Dashboard mínimo, fuera de este módulo).
  - **Prueba 3, conflicto:** la v2 no corre en el PC (el worker no sirve la web y `CORS_ORIGIN` es solo
    el WebView), y la v1 escribe en su propia base. El «PC» fue un `PUT` desde el WebView del teléfono
    con su token, por `fetch` directo para que la caché de la app no se enterara: base = `save_id`
    del servidor, texto con una línea `[PC]`.
    - Johan, en modo avión, escribió sobre la versión anterior y volvió la señal. El servidor guardó
      lo del «PC» como copia; Johan tocó «Agregar al final», que encola el `DELETE` de la copia antes
      que el `PUT`. Una lectura de D1 cayó entre los dos y vio la entrada de 29 caracteres sin copia.
    - Estado final: una fila del día con 82 caracteres (lo del teléfono, línea en blanco y lo del
      «PC»), sin copias, cola del teléfono vacía, `users.xp` 1094 = suma, una sola concesión.
  - **Prueba 4, teclado:** bien en el teléfono en horizontal. **Tablet: pendiente**, no tiene la APK.
  - **CPU en producción: pendiente.**
  - Verificación tras el arreglo: `typecheck`, 209 tests y `build` en verde. El worker no cambió: sin
    deploy nuevo. Al cerrar, ningún `wrangler` ni `workerd` vivo y sin `adb forward`.
