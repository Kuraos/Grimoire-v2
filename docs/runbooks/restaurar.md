# Restaurar la base de producción

Probado en el ensayo de la fase 3 (`docs/tasks/fase-3-respaldo.md`, 3.3) el 2026-11-16. Comandos
desde `api/crates/worker/`, con `npx --yes wrangler@4.156.0` (abajo, `wrangler`). En Git Bash.

## ¿Time travel o dump?

| Situación | Camino |
|---|---|
| La base `grimoire` existe y el daño tiene **menos de 7 días** (plan gratis; la ayuda de wrangler dice 30, que es del plan pago) | **Time travel**, en el sitio. Sección A. |
| La base se borró, la cuenta se perdió, o el daño tiene más de 7 días | **Dump** del repo privado. Sección B. |

Antes de cualquiera de los dos: **ningún dispositivo escribe** hasta terminar. Lo que esté en la
cola de un dispositivo se reenvía después; las escrituras son idempotentes por id (ADR 0004).

## A. Time travel

```bash
wrangler d1 time-travel info grimoire --timestamp=2026-11-16T19:00:00Z   # el bookmark de ese instante
wrangler d1 time-travel restore grimoire --timestamp=2026-11-16T19:00:00Z
```

El restore reemplaza la base viva y devuelve un bookmark del estado anterior: anotarlo, sirve para
deshacer el restore con `--bookmark`. No cambia el `database_id`, así que no hay que desplegar.
Después, la sección C.

## B. Desde un dump

1. **Elegir el dump.** Diario: artefacto `grimoire-AAAA-MM-DD` de `Kuraos/grimoire-backups`
   (30 días). Mensual: Release `mensual-AAAA-MM`. Si la base vive, uno nuevo:
   `gh workflow run respaldo.yml -R Kuraos/grimoire-backups` y `gh run watch <id> --exit-status`.
2. **Descargar y descifrar** con una copia externa de la llave `age`, en un temporal:
   ```bash
   t=$(mktemp -d)
   gh run download <run-id> -R Kuraos/grimoire-backups -D "$t"        # o: gh release download mensual-AAAA-MM
   age -d -i <ruta de la llave> -o "$t/dump.sql" "$t"/*/*.age
   python -I ../../../scripts/verify_dump.py "$t/dump.sql" --migrations ../../migrations
   ```
   Si `verify_dump.py` no dice «dump verificado», probar con el dump anterior.
3. **Base nueva e import.** Cuesta unas 4 escrituras por fila (los índices cuentan): el ensayo, con
   9 622 `INSERT`, gastó 38 501 de las 100 000 diarias de la cuenta. Si no caben, esperar a las
   00:00 UTC (19:00 en Bogotá).
   ```bash
   wrangler d1 create grimoire-restore                  # imprime el database_id
   wrangler d1 execute grimoire-restore --remote --yes --file "$t/dump.sql"
   ```
   El ensayo tardó 8 s. Comprobar: `users.xp` = `SUM(xp_log.amount)` y 8+ filas en `d1_migrations`.
4. **Apuntar producción a la base nueva.** En `wrangler.toml`, el bloque `[[d1_databases]]` de
   arriba (no el de `env.bench`): `database_name` y `database_id` de la nueva. Luego
   `npm run build` en `app/` (el deploy sube `app/dist`) y `wrangler deploy`. Los secretos de los
   tokens son del worker, no de la base: no cambian. Commit del `wrangler.toml`.
5. **Probar antes con bench (opcional, es lo que hizo el ensayo):** cambiar el bloque de `env.bench`
   en vez del de producción, `echo -n <token> | wrangler secret put GRIMOIRE_TOKEN_PC --env bench`,
   `wrangler deploy --env bench`, y comparar (sección C). Al terminar, revertir `wrangler.toml`,
   `wrangler deploy --env bench`, `wrangler secret delete GRIMOIRE_TOKEN_PC --env bench`.
6. Borrar el temporal: `rm -rf "$t"`.

## C. Antes de volver a usar la app

- `curl .../health` → 200; `/user` sin bearer → 401.
- Si la base vieja todavía responde (caso del ensayo), comparar las dos APIs sin imprimir tokens:
  ```bash
  python -I scripts/compare_restore.py URL_A token_a.txt URL_B token_b.txt \
      --date $(TZ=America/Bogota date +%F) --diary-day AAAA-MM-DD ...
  ```
  Los días con diario: `SELECT local_date FROM diary_entries`. Si alguna diferencia viene de la
  hora (no pasó en el ensayo), excluirla con `--ignore CLAVE` y anotarla.
- Si no hay base vieja: el Inicio, Hábitos y el diario de un día conocido se ven como antes, en el PC.
- En cada dispositivo, abrir la app con red y mirar que la cola se vacíe sin rechazos.

## Tiempo medido en el ensayo (2026-11-16)

Del `workflow_dispatch` (19:40:48 UTC) a la comparación en verde (19:46:07): **5 min 19 s**,
contando unos 2 min esperando un token válido de producción. El workflow tardó ~45 s; el import, 8 s;
el deploy de bench, ~15 s.
