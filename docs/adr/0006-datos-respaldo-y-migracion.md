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
- **Backfill de logros:** además de copiar los ya desbloqueados, la migración calcula la
  racha actual de cada hábito activo y desbloquea los logros de racha que falten. En la
  v2, `complete` solo mira la racha del hábito que se marca
  (`docs/tasks/caracterizacion-v1.md`, fila 8), así que un logro pendiente no saltaría
  al marcar otro hábito.
- **`mark_id` de las marcas migradas:** cada marca enlaza su entrada de `xp_log` (v1:
  `source = 'habit'`, `source_id` = el hábito, `amount > 0`) emparejando por `habit_id` y
  `earned_at ≈ completed_at`. Cada entrada se usa una sola vez, y las dos fechas se
  comparan antes de pasarlas a UTC. La tolerancia se fija al escribir el script,
  comprobándola en la copia de los datos reales. Una entrada o marca que no case queda sin
  `mark_id`; **deshacer una marca sin `mark_id` no devuelve XP**.
- **Claves `rank` de las tareas:** las que genere la migración no terminan en `0`. Entre `x` y
  `x0` no cabe ninguna clave (nada ordena antes de `0`), así que una tarjeta soltada ahí no
  podría quedar entre las dos: `rankBetween` la deja después de ambas.
- **Repetible:** se prueba contra una copia fresca de los datos reales cada vez que
  cambie el esquema, en una base D1 local, con verificación de conteos por tabla y de
  totales (XP, saldos). Los datos reales y el SQL generado nunca se commitean.
- El cambio definitivo es un evento con fecha (ver `docs/ROADMAP.md`): export final de
  la v1, migración, verificación, y desde ahí la v1 queda de solo lectura.
