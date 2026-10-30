# Fase 0 — Prueba de arquitectura (un hábito de punta a punta)

Objetivo: validar con algo pequeño las decisiones de los ADR 0001–0004 antes de portar
los 115 endpoints de la v1. Si una tarea revela que una decisión no se sostiene, se para
y se escribe en «Hallazgos» al final de este archivo, en vez de rodearla en silencio.

Cada tarea es una sesión de agente. Al terminar: verificación de `AGENTS.md` en verde,
un commit por tarea (`fase-0: <tarea>`), y una línea en «Hallazgos» si apareció algo.

---

## 0.1 — Workspace y crate `grimoire-domain`

Crear `api/` como workspace de Cargo con `crates/domain` (`grimoire-domain`) y portar,
desde la v1, **solo** estas reglas:

| Regla | Origen en la v1 |
|---|---|
| `xp_to_level`, `xp_for_level` | `backend/constants.py` |
| `title_for_level` (`LEVEL_TITLES`) | `backend/constants.py` |
| `streak_multiplier` (`STREAK_BONUS`) | `backend/constants.py` |
| Cadencia: diaria con `days` opcional (0 = lunes) o semanal con `target_per_week` | `backend/services.py` (`parse_days`, `scheduled_on`, `last_scheduled`, `prev_scheduled`, `next_scheduled`) |
| Racha actual y mejor racha | `services.py` (`habit_streak`, `best_streak`) |
| ¿Se puede marcar hoy? y XP que paga la marca | `services.py` (`mark_habit_done`, `award_xp`) |

Diseño:

- Funciones puras. «Hoy» entra como `chrono::NaiveDate`. Las marcas entran como el
  conjunto de `local_date` del hábito (ver ADR 0004), ya deduplicadas.
- `Cadence` como enum (`Daily { days: Option<WeekdaySet> }`, `Weekly { target: u8 }`),
  no como strings.
- Marcar devuelve un `Result` con motivos tipados (`AlreadyDoneToday`,
  `WeeklyTargetMet`), equivalentes a `HABIT_DONE_TODAY` / `HABIT_WEEK_TARGET_MET`.
- La racha que decide el multiplicador es la **previa + 1** (la v1 la lee antes de
  insertar; ver el comentario en `mark_habit_done`).
- El XP total nunca baja de 0 y lo que se registra es lo aplicado (`award_xp`).

**Redondeo — cambio deliberado frente a la v1.** La v1 calcula
`round(xp_reward * multiplicador)` en float con el `round` de Python, que redondea
mitades al par y arrastra error binario. Verificado en Python 3.14 contra la v1:
`15 × 1.10 = 16.5 → 16`, pero `25 × 1.10 = 27.500000000000004 → 28`, y
`30 × 1.35 = 40.5 → 40`. La v2 guarda el multiplicador en enteros (puntos básicos:
1.10 → 11000) y redondea mitades hacia arriba: `(xp * bp + 5000) / 10000`. Resultado:
16.5 → 17 y 40.5 → 41. Es una diferencia de ±1 XP solo en casos de mitad exacta; el XP
histórico migrado no se recalcula. Los tests deben cubrir esos tres casos con el valor
**nuevo**.

Tests (en `crates/domain/tests/` o módulos `#[cfg(test)]`), mínimo:

- `xp_to_level`: −50→1, 0→1, 399→1, 400→2, 899→2, 900→3, 10000→10.
- `title_for_level`: 1 Iniciado, 12/13/14 Oráculo Perpetuo, 15/19 Arconte de la
  Voluntad, 20/25 Ente del Éter Puro.
- Multiplicador: 6→1.0, 7→1.10, 14→1.20, 30→1.35, 60→1.50, 100→1.75.
- Racha diaria con días L–V: un sábado sin marca no rompe la racha; una marca extra en
  sábado no la parte en `best_streak`.
- Racha con margen: si hoy aún no se marca, la racha se ancla en la unidad anterior.
- Semanal 2×/semana: una semana con 1 marca no cuenta; con 2 sí; una tercera marca se
  rechaza con `WeeklyTargetMet`.
- Marcar dos veces el mismo día → `AlreadyDoneToday`.
- Antes de escribir la implementación, mira `backend/tests/test_api.py` de la v1 y porta
  los casos de rachas/cadencias que encuentres.
- Diseña la racha para que reciba marcas con `local_date` pasada (ADR 0005): marcar
  «ayer» desde una cola offline es un caso normal, no un error. Vidas y penalización
  (`evaluate_days`) **no** entran en esta tarea, pero que el diseño no las impida.
- Los tests de caracterización completos (`docs/tasks/caracterizacion-v1.md`) se hacen
  en la fase 2; aquí bastan los casos de arriba.

Terminado: `cargo fmt --check`, `cargo clippy -D warnings` y `cargo test -p grimoire-domain`
en verde. `grimoire-domain` no depende de `worker`.

## 0.2 — Crate `grimoire-worker` y migración inicial de D1

- `crates/worker` (`grimoire-worker`), `crate-type = ["cdylib"]`, con `worker`
  (features `d1`, `http`, `axum`) y axum. Partir de la plantilla oficial de workers-rs y
  de la documentación de la versión que quede en `Cargo.lock`; anotar en «Hallazgos» la
  versión fijada.
- `wrangler.toml` (o `.jsonc`) con binding D1 `DB`, base `grimoire`, variable
  `GRIMOIRE_TZ = "America/Bogota"`. No poner `database_id` real de producción todavía:
  basta con la base local.
- `api/migrations/0001_init.sql` con solo: `users`, `habits`, `habit_logs`, `xp_log`.
  IDs `TEXT PRIMARY KEY` (UUID). `habit_logs` con `local_date TEXT NOT NULL`,
  `completed_at TEXT NOT NULL` (RFC 3339 UTC) e índice único `(habit_id, local_date)`
  (en la v1 ningún hábito, diario o semanal, se marca dos veces el mismo día). Dinero no aplica aún.
- Rutas:
  - `GET /health` sin auth.
  - `GET /habits` → hábitos activos con racha actual (calculada con `grimoire-domain`).
  - `POST /habits` → crea un hábito; el cliente manda el `id`. Repetir el mismo `id`
    devuelve el mismo hábito, no un duplicado.
  - `POST /habits/{id}/complete` → valida con `grimoire-domain`, inserta la marca, suma
    XP, devuelve `{ xp_earned, new_xp, new_level, title, leveled_up, streak }`. Motivos
    de rechazo como 409 con mensaje en español.
- Auth: `Authorization: Bearer <token>` comparado en tiempo constante contra el secreto
  `GRIMOIRE_TOKEN` (`.dev.vars` en local). 401 si falta o no coincide.
- Las escrituras de una marca (log + XP + usuario) van en un solo `batch`.

Terminado: con `npx wrangler dev` y la migración aplicada en local, esta secuencia
funciona con `curl` y la salida va pegada en el commit o en «Hallazgos»:
`/health` 200 → `/habits` sin token 401 → crear hábito → completar 200 → completar otra
vez 409 → `/habits` muestra racha 1.

## 0.3 — Despliegue y medición (la hace o la autoriza Johan)

- `wrangler d1 create grimoire`, aplicar migración remota, `wrangler secret put
  GRIMOIRE_TOKEN`, `wrangler deploy`.
- Repetir la secuencia de `curl` contra `*.workers.dev` **desde el celular con datos**.
- Medir CPU por request en el dashboard (Workers → métricas) o con `wrangler tail`.
  Anotar en «Hallazgos» el valor de `POST /habits/{id}/complete` frente al límite de 10 ms.
- Medir también `GET /habits` con un seed **sintético** (nada de datos reales, invariante 7):
  ~10 hábitos activos (diarios, L–V y semanales) y ~3 años de marcas (≈ 10 000 filas de
  `habit_logs`). Hoy esa ruta lee todas las marcas de los hábitos activos y calcula la
  racha de cada uno, así que es la candidata a pasarse de los 10 ms. Anotar CPU y
  tiempo de D1; si queda cerca del límite, acotar la lectura (p. ej. solo marcas desde
  la mejor racha posible hacia atrás) antes de seguir.

Terminado: números anotados. Si el CPU queda cerca de 10 ms, se para y se revisa el
ADR 0002.

## 0.4 — APK mínima con Capacitor (cuando Android Studio esté listo)

- `app/` con Vite + React + TS y Capacitor Android. Una sola pantalla: lista de hábitos
  y botón «marcar» contra la API desplegada, token en almacenamiento seguro.
- Una notificación local agendada a 2 minutos que suene con la app cerrada y la pantalla
  apagada. Manejar el permiso de alarmas exactas de Android 14 (ADR 0003).
- APK debug instalada en el teléfono (llave debug; el keystore de release se genera
  después, siguiendo ADR 0006, y nunca entra al repo).

Terminado: Johan marca un hábito desde el teléfono con datos móviles y recibe la
notificación con la app cerrada.

---

## Hallazgos

(Agregar aquí lo que se descubra: versiones fijadas, APIs que no funcionaron como dicen
los docs, mediciones de CPU, decisiones tomadas sobre la marcha.)

- **0.1** (2026-10-29): `chrono 0.4.45` sin la feature `clock` (el dominio no puede leer
  el reloj). Paridad heredada de la v1, sin cambiar: en un semanal la marca paga con
  racha previa + 1 aunque no cierre la semana (1.ª de 2), y en un diario L–V una marca
  extra en sábado también paga con previa + 1. Revisar en la caracterización (fase 2).
- **0.2** (2026-10-29): versiones fijadas en `Cargo.lock`: `worker` / `worker-macros` /
  `worker-build` 0.8.7, `axum` 0.8.9; `wrangler` 4.156.0 como devDependency de
  `crates/worker` (correr `npm install` ahí antes de `npx wrangler`). Partí de
  `templates/axum` de workers-rs (commit `1d668cf`).
  - D1 local funciona sin `database_id` en `wrangler.toml`.
  - «Hoy» sale de `Intl` del runtime (`toLocaleDateString("en-CA", { timeZone })`), no
    de `chrono-tz`: no hace falta meter la base de zonas en el wasm. Verificado: marca a
    las `2026-10-30T00:49Z` → `local_date = 2026-10-29`.
  - `uuid` 1.29 necesita `std` + `v7` + `js` para `now_v7()` en wasm; toma el reloj de
    `Date.now`. Solo lo usa `xp_log`, que es un registro derivado en el servidor; las
    marcas y los hábitos llevan el UUID del cliente.
  - `POST /habits/{id}/complete` recibe `{ "id": <uuid de la marca>, "local_date"?: "YYYY-MM-DD" }`;
    `local_date` fuera de hoy/ayer/anteayer → 409 (ADR 0005, `check_mark_day` en el dominio).
  - Trampa en Windows: `curl -d '…Académico…'` desde Git Bash manda cp1252 y el worker
    responde 422 (JSON no UTF-8). Con `--data-binary @archivo.json` en UTF-8, bien.
  - Secuencia de `curl` contra `wrangler dev` (salida recortada):
    ```
    GET  /health                       → 200 ok
    GET  /habits (sin token)           → 401 {"detail":"No autorizado"}
    POST /habits                       → 201 {"id":"6136…","days":"0,4",…}
    POST /habits (mismo id)            → 200 (mismo hábito, sin duplicar)
    POST /habits/{id}/complete         → 200 {"xp_earned":20,"new_xp":20,"new_level":1,"title":"Iniciado","leveled_up":false,"streak":1}
    POST /habits/{id}/complete (otra)  → 409 {"detail":"Este hábito ya fue completado ese día"}
    GET  /habits                       → 200 [{…,"streak":1,"done_today":true}]
    semanal 2×: ayer 200, hoy 200, anteayer → 409 «ya alcanzó su meta de 2× esta semana»
    ```
- **Idempotencia, CORS y marcas antes de crear** (2026-10-29):
  - `complete` lee primero si el `id` de la marca ya existe. Mismo hábito → 200 con el
    estado actual y `xp_earned: 0` (la racha es la del día de esa marca). Otro hábito →
    409. Se revisa antes que la ventana de gracia: reintentar una marca vieja sigue
    dando 200.
  - D1 distingue los dos choques en el mensaje: `UNIQUE constraint failed:
    habit_logs.id: … SQLITE_CONSTRAINT_PRIMARYKEY` y `UNIQUE constraint failed:
    habit_logs.habit_id, habit_logs.local_date: … SQLITE_CONSTRAINT_UNIQUE`. El primero
    se trata como reintento (relee y responde 200); el segundo es `AlreadyDoneToday`.
    En las carreras con `curl` en paralelo, todo salió consistente (XP de `users` =
    suma de `xp_log`), pero no sé si alguna request llegó a la rama del PK o si D1
    local las serializó todas antes del chequeo previo: esa rama no está ejercitada
    de forma demostrable.
  - Origen de Capacitor en Android: la documentación de Capacitor v8
    (capacitorjs.com/docs/config) fija `server.androidScheme` en `"https"` y
    `server.hostname` en `"localhost"` por defecto, así que el origen es
    `https://localhost`. Es una deducción a partir de esos dos valores: la página no
    escribe el origen literal. Hay que confirmarlo en la 0.4 con la APK real (cabecera
    `Origin`). Configurable con `CORS_ORIGIN` en `wrangler.toml`.
  - CORS no reemplaza la auth: un origen ajeno con token recibe 200 igual (fuera del
    navegador no hay CORS). Solo impide que otra página use el token desde un navegador.
  - Trampa en Windows: en Git Bash, `TZ=America/Bogota date` no entiende zonas IANA y
    da UTC. Para fechas locales en pruebas, usar
    `node -e 'new Date().toLocaleDateString("en-CA",{timeZone:"America/Bogota"})'`.
  - Pruebas con `curl` contra `wrangler dev` (salida recortada; hoy = 2026-10-29 en Bogotá):
    ```
    complete (id M)                          → 200 {"xp_earned":20,"new_xp":100,…,"streak":1}
    complete (mismo id M)                    → 200 {"xp_earned":0,"new_xp":100,…,"streak":1}
    complete (otro id, mismo día)            → 409 «Este hábito ya fue completado ese día»
    complete en otro hábito con id M         → 409 «Ese id de marca ya pertenece a otro hábito»
    5 en paralelo, mismo id                  → 200 (xp 20) + 4 × 200 (xp 0)
    5 en paralelo, ids distintos, mismo día  → 200 + 4 × 409
    local_date=2026-10-28, hábito creado hoy → 409 «El hábito aún no existía ese día»
    OPTIONS Origin https://localhost, sin token → 204
      Access-Control-Allow-Origin: https://localhost
      access-control-allow-headers: Authorization, Content-Type
      access-control-allow-methods: GET, POST, OPTIONS
    OPTIONS Origin https://evil.example      → 204 sin cabeceras CORS
    GET /habits Origin https://localhost     → 200 con Access-Control-Allow-Origin
    GET /habits Origin https://localhost, sin token → 401 con Access-Control-Allow-Origin
    GET /habits Origin https://evil.example  → 200 sin Access-Control-Allow-Origin
    ```
