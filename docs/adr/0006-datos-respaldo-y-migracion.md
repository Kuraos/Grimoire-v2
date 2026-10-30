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
- **Repetible:** se prueba contra una copia fresca de los datos reales cada vez que
  cambie el esquema, en una base D1 local, con verificación de conteos por tabla y de
  totales (XP, saldos). Los datos reales y el SQL generado nunca se commitean.
- El cambio definitivo es un evento con fecha (ver `docs/ROADMAP.md`): export final de
  la v1, migración, verificación, y desde ahí la v1 queda de solo lectura.
