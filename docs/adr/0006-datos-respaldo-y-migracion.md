# ADR 0006 — Respaldo, llave de firma y migración desde la v1

Estado: aceptado (2026-10-29)

## Contexto

La v2 guarda en la nube datos personales (diario, finanzas) y el repo es público. El
time travel de D1 solo cubre 7 días. La APK se instala por sideload y se firma con una
llave propia. La v1 tiene meses de datos en `%APPDATA%\Grimoire\grimoire.db`.

## Decisión

### Respaldo

- **Export diario de D1** (`wrangler d1 export`) desde una GitHub Action programada que
  corre en un **repo privado aparte** (p. ej. `Kuraos/grimoire-backups`), nunca en
  `Grimoire-v2`: los artefactos y logs de un repo público los puede ver cualquiera.
- El token de Cloudflare de la Action con permiso mínimo (solo lectura/export de D1),
  guardado como secreto del repo privado.
- El dump se cifra antes de guardarse (p. ej. con `age`); la llave privada vive fuera de
  GitHub. Retención: diarios de 30 días y uno mensual indefinido.
- **Ensayo de restauración** antes de migrar los datos reales: restaurar un dump en una
  base D1 local y comprobar conteos y una racha conocida. Se repite si cambia el
  procedimiento. Un backup que nunca se restauró no está comprobado.
- Pendiente de verificar al implementarlo: minutos gratis de Actions en repos privados y
  si `wrangler d1 export` funciona con un token restringido.

### Llave de firma de la APK

- El keystore de release se genera una vez y **nunca entra a ningún repo** (`*.keystore`
  y `*.jks` ya están en `.gitignore`).
- Copia en al menos dos lugares fuera del PC (p. ej. gestor de contraseñas y una unidad
  aparte), junto con su contraseña. Perderla obliga a desinstalar la app en cada
  dispositivo para instalar una versión nueva.
- Las APK de desarrollo usan la llave debug; la de release solo se usa para lo que se
  publica en GitHub Releases.

### Migración desde la v1

- **La v1 está congelada en funciones** desde el 2026-10-29: solo arreglos de bugs
  hasta el cambio. Toda función nueva va a la v2.
- `scripts/migrate_v1.py` (Python, `-I`): lee una **copia** de `grimoire.db`, genera SQL
  para D1. Asigna UUID a cada fila, guarda un mapa id-viejo → UUID para mantener las
  relaciones, convierte las fechas naive (hora de Bogotá) a UTC y rellena `local_date`
  con la fecha local original (ADR 0004). El XP histórico se copia, no se recalcula.
- **Backfill de logros:** se copian los desbloqueados en la v1 con su `unlocked_at`
  original, y se desbloquean solo los de racha que falten según la racha actual de cada
  hábito activo; ninguno se vuelve a bloquear ni cambia de fecha. En la
  v2, `complete` solo mira la racha del hábito que se marca
  (`docs/tasks/caracterizacion-v1.md`, fila 8), así que un logro pendiente no saltaría
  al marcar otro hábito.
- **`mark_id` de las marcas migradas:** cada marca enlaza su entrada de `xp_log` (v1:
  `source = 'habit'`, `source_id` = el hábito, `amount > 0`) emparejando por `habit_id` y
  `earned_at ≈ completed_at`. Cada entrada se usa una sola vez, y las dos fechas se
  comparan antes de pasarlas a UTC. La tolerancia se fija al escribir el script,
  comprobándola en la copia de los datos reales. Una entrada o marca que no case queda sin
  `mark_id`; **deshacer una marca sin `mark_id` no devuelve XP**.
- **`remind_at` de las tareas:** en la v1 es una fecha naive en hora de Bogotá; la migración
  la convierte a RFC 3339 UTC, igual que las demás fechas. La UI de la v2 la muestra y la edita
  en `America/Bogota`.
- **Sesiones de pomodoro:** `started_at` y `finished_at` naive (hora de Bogotá) pasan a UTC, y
  `local_date` sale de `finished_at` antes de convertir. Una sesión con `finished_at` nulo se
  decide al ver los datos reales. `task_id` o `project_id` colgantes pasan a `NULL`, y sus horas
  dejan de contar para el proyecto borrado, que la v1 ya no muestra. El XP histórico se copia, y
  lo migrado no necesita `mark_id`, porque las sesiones no se deshacen.
- **Entradas del diario** (`docs/tasks/fase-2-diario.md`): `entry_date` pasa a `local_date` y
  `updated_at` naive (hora de Bogotá) a UTC. Cada entrada recibe un `save_id` nuevo, que es la base
  del primer guardado desde la v2. `written` se calcula con `diary::is_written`; las filas vacías o
  de solo espacios se deciden al ver los datos reales (decisión 4). El XP histórico se copia con
  `mark_id` = id nuevo de la entrada, para que reescribir una entrada migrada no pague de nuevo.
  Logros de diario (`archivist`, `diary_century`), con la regla del backfill de rachas: se copian
  los desbloqueados en la v1 con su `unlocked_at` original, y se desbloquean solo los que falten
  según el conteo de entradas escritas; ninguno se vuelve a bloquear ni cambia de fecha.
- **Claves `rank` de las tareas:** las que genere la migración no terminan en `0`. Entre `x` y
  `x0` no cabe ninguna clave (nada ordena antes de `0`), así que una tarjeta soltada ahí no
  podría quedar entre las dos: `rankBetween` la deja después de ambas.
- **Nivel guardado frente al XP, antes de migrar:** en la copia real de la v1 se cuentan las
  filas de `users` con `level ≠ xp_to_level(xp)`. La v2 calcula el nivel del XP
  (`xp::level_progress`), así que un nivel guardado que no cuadre no se arrastra, pero el nivel
  que ve Johan podría cambiar de golpe el día del cambio. Se decide con ese conteo. En la v1,
  `award_xp` recalcula el nivel en cada escritura de XP (`caracterizacion-v1.md`, «Hallazgos»,
  Usuario), así que lo esperado es 0.
- **Repetible:** se prueba contra una copia fresca de los datos reales cada vez que
  cambie el esquema, en una base D1 local, con verificación de conteos por tabla y de
  totales (XP, saldos). Los datos reales y el SQL generado nunca se commitean.
- El cambio definitivo es un evento con fecha (ver `docs/ROADMAP.md`): export final de
  la v1, migración, verificación, y desde ahí la v1 queda de solo lectura.
