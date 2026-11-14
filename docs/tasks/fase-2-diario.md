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
   - `GET /diary/conflicts/{date}` y `DELETE /diary/conflicts/{id}` (decisión 1). Repetir el `DELETE`
     da 204, así que cumple el contrato de la cola.

8. **Resumen del día sin check-in.** Hábitos marcados (`local_date`), sesiones y minutos completos
   de pomodoro (`local_date`) y XP del día. El XP no tiene `local_date`: se suma `xp_log` entre
   `D 05:00Z` y `D+1 05:00Z` (Bogotá es UTC−5 fijo, sin horario de verano). La fila de energía y ánimo
   no se muestra hasta que lleguen los check-ins (fila 36).

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
