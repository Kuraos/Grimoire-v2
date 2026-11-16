# Fase 3 — Respaldo y ensayo de restauración

**Estado: plan aprobado por Johan el 2026-11-15. 3.1 y 3.2 terminadas el 2026-11-16.** Siguen la
3.3, la 3.4 y la 3.5.

Depende de: la fase 2 cerrada (`fase-2-transversal.md`) y el ADR 0006. **La fase 4 (migración) no
empieza sin esta** (`ROADMAP.md`).

Objetivo: que perder la base de D1, el PC o un dispositivo no cueste datos. Sale cuando un dump de
producción, descargado del repo privado y descifrado con la copia externa de la llave, se restaura
en una D1 nueva y la API sobre él responde lo mismo que producción (3.3), y cuando la llave de
firma de la APK y la base de la v1 tienen respaldo comprobado (3.4 y 3.5).

Cada tarea es una sesión de agente. Al terminar: verificación de `AGENTS.md` en verde, un commit
por tarea (`fase-3: <tarea>`) y una línea en «Hallazgos» si apareció algo. Si una tarea revela que
una decisión no se sostiene, se para y se anota, en vez de rodearla. Nada remoto (Cloudflare,
GitHub, dispositivos) sin el permiso de Johan en el punto marcado con ⛔.

---

## Lo comprobado al planear (2026-11-15)

| Hecho | Fuente |
|---|---|
| `wrangler d1 export` **bloquea la base** mientras corre | Docs de D1, «Import and export data», Known limitations |
| El export **no funciona con tablas virtuales** (FTS5). Hoy no hay ninguna en `api/migrations/` | Misma página; `grep` sobre las migraciones |
| Plan gratis: time travel de **7 días** y **10 bases** por cuenta (en uso: `grimoire` y `grimoire-bench`) | Docs de D1, «Limits» y «Time Travel» |
| La base de la v1 pesa **260 KB** (`%APPDATA%\Grimoire\grimoire.db`) | `ls`, 2026-11-15 |
| No existen `Kuraos/grimoire-backups` ni `age` en el PC | `gh repo view`, `which age` |
| La APK se firma con `~/.android/debug.keystore`, **sin respaldo**. No hay llave de release ni `signingConfig` | `ls ~/.android`, `build.gradle` |

**Sin comprobar** (es la 3.1): el permiso mínimo de un token de Cloudflare para exportar; los minutos
de Actions y el almacenamiento de artefactos en repos privados del plan gratis; si el dump trae
`d1_migrations` y se importa tal cual en `sqlite3`; cuánto bloquea el export.

---

## Decisiones

Tomadas por Johan el 2026-11-15, sobre la propuesta de Hermes.

- **A. El respaldo corre en una GitHub Action de un repo privado aparte** (`Kuraos/grimoire-backups`),
  como dice el ADR 0006. Descartado: Cloudflare Workflows con R2 (otra pieza que mantener, y R2
  probablemente exige registrar un medio de pago; sin comprobar).
- **B. Retención con lo que GitHub caduca solo:** el diario es un **artefacto** con 30 días de
  retención y el del día 1 de cada mes va además a una **Release** (`mensual-AAAA-MM`), que no caduca.
  Descartado: commits en git, porque la historia no se poda y la retención de 30 días no existiría.
- **C. Cada respaldo se verifica el mismo día, antes de cifrar:** la Action importa el dump en
  `sqlite3` y exige `PRAGMA integrity_check` = `ok`, las tablas esperadas con su conteo, `users.xp` =
  `SUM(xp_log.amount)` y en `d1_migrations` la última migración del repo. Si algo falla, la Action
  falla y no sube nada.
- **D. El ensayo de restauración es un desastre simulado en Cloudflare**, no solo en D1 local: dump
  descargado del repo, descifrado con la **copia externa** de la llave, importado en una D1 nueva,
  el worker `bench` apuntando a ella, y la API comparada con producción. Queda un runbook con el
  tiempo medido.
- **E. La base de la v1 se respalda ya:** hasta el cambio, los datos reales viven en un solo disco.
  Copia consistente (API de backup de SQLite, no copiar el archivo), cifrada con la misma llave, al
  mismo repo privado.
- **F. La llave de release de la APK se crea ahora,** y el teléfono y la tablet pasan a ella. Cambiar
  de llave obliga a desinstalar, lo que borra el token del Keystore y la cola local: hoy cuesta poco,
  porque producción solo tiene datos de prueba; después de la migración, no.
- **G. Dos avisos si el respaldo deja de funcionar:** el correo de GitHub cuando la Action falla, y un
  cron semanal de Hermes que revisa la fecha del último respaldo correcto (y del de la v1) y avisa a
  Discord. El segundo cubre lo que el primero no ve: que la Action deje de correr.

### Restricciones que salen de esto

- **Sin tablas virtuales en D1** mientras el respaldo sea `wrangler d1 export`. Si la búsqueda del
  Diario necesitara FTS5, primero se cambia el respaldo.
- El texto plano del dump **solo existe en el runner**, en un directorio temporal. Al log van conteos,
  nunca filas. Las acciones de terceros del workflow se fijan por SHA.
- La llave privada de `age` y el keystore de release **nunca** entran a GitHub, ni a este repo ni al
  privado. En la Action solo vive la llave pública (`AGE_RECIPIENT`).

---

## Pendiente de Johan (resuelto el 2026-11-16)

Johan confirmó dos copias de la llave `age` fuera del PC. Dónde están no se escribe aquí: el repo es
público. Queda a su criterio guardarlas cifradas con frase de paso (`age -p`); el keystore de la 3.4
va a los mismos dos lugares.

**Dónde viven las dos copias externas** de la llave privada de `age`, del keystore de release y de su
contraseña (ADR 0006: al menos dos lugares fuera del PC). Por ejemplo, un gestor de contraseñas y una
memoria USB guardada aparte. Hace falta antes de la 3.2 y la 3.4. Si la única copia se pierde con el
PC, los respaldos cifrados no sirven.

---

## 3.1 — Verificaciones previas

Todo sobre `grimoire-bench` y en local; producción no se toca.

- **Token mínimo:** Johan crea en el panel de Cloudflare un token con permisos de D1 solamente. Se
  prueba `wrangler d1 export` primero con lectura de D1 y, si no alcanza, con edición. Se anota el
  mínimo que funciona y si se puede limitar a una sola base. El token nunca se imprime.
- **Tamaño y bloqueo:** con un seed sintético del tamaño de la v1 multiplicado por 10 (la v1 tiene
  15 hábitos, 70 marcas y 22 sesiones; los scripts `bench_seed*.py` sirven de base), cuánto tarda el
  export, cuánto pesa el dump y cuánto se demora un `GET /habits` lanzado durante el export.
- **Contenido del dump:** si trae `d1_migrations`, si trae `_cf_KV`, y si se importa sin editar en
  `sqlite3` (lo que usa la verificación de C) y en una D1 local con `wrangler d1 execute --local
  --file`. Con la base importada, los conteos por tabla coinciden con los de bench.
- **GitHub, con fuente:** minutos de Actions, almacenamiento de artefactos, retención máxima de
  artefactos en repos privados y límite de tamaño de un asset de Release, en el plan de Johan.
- **`age`:** cómo se instala en Windows (sin depender de que Hermes lo tenga) y en el runner
  `ubuntu-latest`; que un archivo cifrado en uno se descifra en el otro.

Terminado: tabla en «Hallazgos» con cada punto comprobado (fuente o comando) o marcado como no
comprobado, y el seed de bench borrado. Si algo contradice A–G, se para.

## 3.2 — Repo privado, llave y Action diaria

Requiere la respuesta de «Pendiente de Johan».

- **Johan:** crea `Kuraos/grimoire-backups` (privado), genera la llave con `age-keygen`, guarda la
  privada en sus dos lugares, y pone los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` y
  la variable `AGE_RECIPIENT` (pública).
- **Workflow** en el repo privado: diario a las 08:00 UTC (03:00 en Bogotá) y `workflow_dispatch`.
  `wrangler` fijado a la versión de este repo. Pasos: export de producción, verificación de C,
  cifrado con `age -r`, artefacto con `retention-days: 30`, y el día 1 del mes, además, la Release.
- **ADR 0006 actualizado** con B, C, D y las restricciones de arriba, y `ROADMAP.md` con la fase 3.

Terminado:
- Una ejecución manual y una programada en verde.
- Un artefacto descargado y descifrado en el PC **con una copia externa de la llave**, cuyo contenido
  pasa la misma verificación de C.
- Una ejecución que tiene que fallar, falla: el workflow apuntado a `grimoire-bench` con un
  `users.xp` alterado a propósito queda en rojo y no sube artefacto.

## 3.3 — Ensayo de restauración

- Johan no escribe en la app durante la ventana del ensayo (unos 30 min, se coordina). Un
  `workflow_dispatch` produce el dump del ensayo.
- Se descarga, se descifra con la copia externa, se crea una D1 temporal (`grimoire-restore`), se
  importa, se apunta el worker `bench` a ella y se despliega.
- Se compara, con los tokens de cada lado y sin imprimirlos: `GET /user`, `/habits`, `/tasks`,
  `/projects`, `/pomodoro/today?date=` y `/diary/{día}` de los días con entrada, de producción frente
  a la restaurada. Campos que dependen de la hora, excluidos y anotados.
- **`docs/runbooks/restaurar.md`:** cuándo basta el time travel (menos de 7 días, base viva) y cuándo
  hace falta el dump; los pasos con sus comandos; cómo se cambia el `database_id` de producción y se
  despliega; qué se comprueba antes de volver a usar la app; y el tiempo medido en el ensayo.
- Limpieza: `bench` vuelve a su base y `grimoire-restore` se borra.

Terminado: las respuestas coinciden (o cada diferencia está explicada), y el runbook se siguió tal
cual, sin pasos improvisados que no queden escritos. **Con esto se cumple la condición del
`ROADMAP.md` para la fase 3.**

## 3.4 — Llave de release de la APK

Requiere la respuesta de «Pendiente de Johan».

- Keystore de release generado una vez con el `keytool` del JDK de Android Studio, validez larga
  (≥ 25 años), fuera del repo. `signingConfig` de release que lee la ruta y las contraseñas de
  `~/.gradle/gradle.properties` o de variables de entorno, nunca del repo. El emulador sigue con la
  llave debug.
- Johan guarda el keystore y su contraseña en sus dos lugares.
- **Prueba de que la copia sirve:** un segundo build firmado con el keystore **traído de la copia
  externa** se instala encima del primero, sin desinstalar.
- **Paso de los dispositivos:** con la cola vacía en el teléfono y la tablet (comprobado), se
  desinstala la de debug, se instala la de release, se pone el token de cada dispositivo y se
  vuelven a dar los permisos de notificaciones y alarma exacta. En el Infinix, el inicio automático
  de XOS se vuelve a activar.
- El ADR 0006 dice hoy que la llave de release solo firma lo que se publica: se corrige a «firma lo
  que se instala en los dispositivos de Johan».
- La huella SHA-256 del certificado (no es secreta) va a «Hallazgos».

Terminado: los dos dispositivos con la app de release (huella comprobada con `apksigner`), la cola
de los dos sincronizando contra producción, y la instalación desde la copia externa hecha.

## 3.5 — Respaldo de la v1 y alertas

- **v1:** script en `scripts/` que hace una copia consistente de `grimoire.db` con la API de backup
  de SQLite (la v1 puede estar abierta), la cifra con `AGE_RECIPIENT` y la sube como asset a una
  Release `v1-AAAA-MM-DD` del repo privado. Corre semanal con una tarea programada de Windows del
  usuario de Johan (no elevada), y a mano el día del cambio. El texto plano no sale de un temporal.
- **Alerta (la configura Hermes, no es del repo):** cron semanal en Haiku que, con `gh api`, revisa la
  última ejecución correcta del workflow (más de 2 días, alerta) y la última Release `v1-…` (más de 8
  días, alerta), y avisa a Discord.

Terminado: una copia de la v1 descargada, descifrada con la copia externa y abierta en `sqlite3` con
los mismos conteos que la original; la alerta probada una vez forzando la condición.

---

## Hallazgos

- **3.1, verificaciones previas** (2026-11-15, con el «sí» de Johan). Seed: los cuatro
  `bench_seed*.py` sin cambios con `BENCH_HOY=2026-11-15` (9 383 marcas, 500 tareas y 1 015 ítems,
  5 000 sesiones, 1 000 entradas): más de 10 veces la v1 en marcas, sesiones y diario, menos en
  hábitos y tareas. Peor caso de tamaño, no réplica exacta de la forma.

  | Punto | Resultado | Fuente o comando |
  |---|---|---|
  | Token mínimo | **D1 · Read no alcanza**: `GET …/d1/database/grimoire-bench` pasa y `POST …/export` da `Authentication error [code: 10000]`. **D1 · Edit sí.** Si se puede limitar a una base: **no comprobado** | log de `wrangler d1 export`, token de cuenta creado por Johan en el panel |
  | Tiempo del export | 14,3 / 13,3 / 11,9 s de punta a punta (incluye arrancar `npx`) | `wrangler d1 export grimoire-bench --remote --output …`, 3 corridas |
  | Tamaño del dump | 5 904 769 bytes, idéntico en las tres (mismo SHA-256) | `stat`, `sha256sum` |
  | Bloqueo | No hay lentitud: hay **500**. En cada export, 2 `GET /habits` seguidos fallan (~1–1,5 s); las 200 tienen la mediana de siempre (0,50–0,52 s contra 0,51 s sin export, desde Bogotá) | `curl` a bench, 20 sin export y 15 durante cada export |
  | `d1_migrations` | Viene, como `CREATE TABLE IF NOT EXISTS`, con las 8 migraciones | `grep` sobre el dump |
  | `_cf_KV` | No viene | `grep` → 0 |
  | Import en `sqlite3` | Sin editar; `verify_dump.py` pasa (`integrity_check` ok, 12 tablas, xp 0 = 0, `0008` presente) | `python -I scripts/verify_dump.py` |
  | Import en D1 local | Sin editar (17 024 comandos); conteos de las 13 tablas iguales a bench | `wrangler d1 execute --local --persist-to <temporal> --file` |
  | Actions (Free, privado) | Crédito de 12 USD/mes; Linux 2-core a 0,006 USD/min (≈ 2 000 min) | docs.github.com/en/billing/concepts/product-billing/github-actions |
  | Artefactos | 500 MB de almacenamiento (compartido con Packages) | misma página |
  | Retención de artefactos (privado) | 90 días por defecto, configurable de 1 a 400 | docs.github.com, «Configuring the retention period for GitHub Actions artifacts and logs» |
  | Asset de Release | < 2 GiB por archivo; sin límite de tamaño total ni de ancho de banda | docs.github.com, «About releases» |
  | Plan de la cuenta de Johan | **No comprobado** (`gh` sin scope `user`; `gh api user` da `plan: null`). Se asume Free | — |
  | `age` en Windows | `winget install FiloSottile.age` → v1.3.2 (zip portable de los releases de FiloSottile) | `age --version` |
  | `age` en `ubuntu-latest` | `apt install age` → 1.1.1 (`universe`) | packages.ubuntu.com/noble/age; contenedor `ubuntu:24.04` |
  | Windows → Linux | Dump cifrado con `age -r` en Windows (1.3.2), descifrado en `ubuntu:24.04` (1.1.1): mismo SHA-256 | Docker |

  - **Contra el ADR 0006:** pedía un token de «solo lectura/export de D1»; exportar exige **D1 ·
    Edit**. Johan lo acepta así por ahora y revisa los permisos después. Si el token no se puede
    limitar a una base, el de la Action puede escribir y borrar en producción. No contradice A–G.
  - **El log del export trae un enlace firmado de R2, válido una hora, al dump en texto plano.** En
    la 3.2 la salida de `wrangler d1 export` no puede ir al log de la Action tal cual (restricción
    «al log van conteos, nunca filas»).
  - **Los 500 durante el export** los absorbe el cliente: un 5xx es transitorio y la cola reintenta
    sin descartar (`app/src/api/queryClient.ts`, test `un 5xx persistente avisa una vez y sigue en
    cola`). A las 03:00 de Bogotá no debería pasar nada.
  - **Incidente: límite diario de filas escritas de D1 agotado.** El seed de la 2.5.4 y el de esta
    tarea cayeron en el mismo día UTC, y el borrado del seed dio `code: 7500` («exceeded D1's free
    tier daily row write limit»). El límite (100 000 filas al día, índices incluidos) es **de la
    cuenta**: producción quedó sin escrituras desde ~18:58 UTC hasta las 00:00 UTC (19:00 de
    Bogotá). La cola del cliente retiene lo marcado. Regla: antes de sembrar o limpiar bench, sumar
    las filas a escribir y las ya gastadas ese día UTC. El invariante 8 de `AGENTS.md` no lo lista.
  - **Limpieza** (2026-11-16, ~06:00 UTC, con el «sí» de Johan). La del 15-nov quedó a medias por
    el límite: seguían 10 `habits`, 9 383 `habit_logs`, 40 `projects` y 5 000 `pomodoro_sessions`.
    `DELETE FROM pomodoro_sessions` → 5 000 filas escritas; `DELETE FROM habits` (la cascada borra
    `habit_logs`) → 9 393; `DELETE FROM projects` → 40. **`meta.rows_written` de un `DELETE` cuenta
    filas de tabla, no entradas de índice**: había estimado ≈ 58 000 suponiendo cuatro escrituras
    por fila. Queda pendiente confirmar si el cobro real del límite sigue a ese `meta`. Además,
    `wrangler d1 info` da `rows_written_24h` en ventana móvil, no por día UTC. Bench queda con
    las 12 tablas sin datos, el usuario en `xp` 0, 3 vidas y `settled_through` NULL, sin secretos
    (`wrangler secret list --env bench` → `[]`) y sin `wrangler` ni `workerd` vivos.

- **3.2 y 3.5, adelanto sin la llave real** (2026-11-16). Probado con una llave `age` desechable en
  un temporal, que ya no existe.
  - `scripts/backup_d1.sh`: export, `verify_dump.py` y cifrado. La salida de wrangler no va al log
    (si falla, sale con las URL tapadas) y el texto plano vive en un `mktemp -d` que se borra al
    salir. Contra bench vacío: 8,3 s, dump verificado y cifrado de 14 382 bytes; descifrado, vuelve
    a pasar la verificación. Contra la D1 local, que tiene seeds sin tocar `users` (`xp` 190 frente
    a 641 en `xp_log`), lo rechaza y no deja archivo: es el camino de falla.
  - `scripts/grimoire-backups.yml`: el workflow que se copia al repo privado. Clona `main` de este
    repo, así que **`backup_d1.sh` tiene que estar en `main` antes de la primera ejecución**.
    `actions/checkout` v7.0.1 y `actions/upload-artifact` v7.0.2 fijadas por SHA; `actionlint`
    1.7.7 (con `shellcheck`) sin hallazgos.
  - `scripts/backup_v1.py`: copia con `sqlite3.backup` de una conexión de solo lectura,
    `integrity_check`, cifrado y Release `v1-AAAA-MM-DD`. Con `--out`: 266 504 bytes cifrados;
    descifrada, 29 tablas con los mismos conteos que la original e `integrity_check` = `ok`. Faltan
    la subida, la tarea programada y el descifrado con la copia externa.

- **3.2, primera ejecución manual** (2026-11-16, 06:30 UTC, con el «sí» de Johan). En
  `Kuraos/grimoire-backups` están los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, que
  puso Johan, y la variable `AGE_RECIPIENT` = `age1wglc3x…eavzsp3jn0j`. La llave se creó el
  2026-11-16 a las 01:27 de Bogotá; la del 01:19 se borró sin usarse. El workflow está en
  `.github/workflows/respaldo.yml`. Ejecución `43817141203` en verde contra producción: 21 hábitos,
  9 434 marcas (el seed de la 0.3 sigue ahí), `users.xp` 1 254 = `SUM(xp_log.amount)` y `0008`
  presente. Cifrado de 1 876 212 bytes; artefacto `grimoire-2026-11-16`, que vence el 2026-12-16. El
  log trae solo conteos y ninguna URL de R2. La Release se saltó porque no era día 1.
  Faltan la programada, el descifrado con la copia externa y la ejecución que tiene que fallar.

- **3.2, programada y ejecución que tiene que fallar** (2026-11-16).
  - Programada: ejecución `43922185186` en verde, pero arrancó a las 17:48 UTC y no a las 08:00.
    GitHub retrasa los `schedule` en repos nuevos o con poca actividad. Se vigila unos días; mientras
    sea diaria, cumple.
  - Falla a propósito: en bench (un usuario, `xp_log` vacío), `users.xp` pasó de 0 a 7 y se disparó
    el workflow con `database=grimoire-bench`. Ejecución `43932854303` en rojo en el paso de
    verificación (`users.xp: 7  SUM(xp_log.amount): 0`, «dump RECHAZADO»), con 0 artefactos.
    Después `users.xp` volvió a 0, comprobado, y no quedaron `wrangler` ni `workerd` vivos.
  - Descifrado con la copia externa: el artefacto `grimoire-2026-11-16` (1 876 212 bytes) se
    descargó con `gh run download` y se descifró con la llave traída de una de las dos copias
    externas (su recipiente coincide con `AGE_RECIPIENT`). Pasó `verify_dump.py` con los mismos
    conteos de la ejecución `43817141203`: 21 hábitos, 9 434 marcas, `users.xp` 1 254 = `xp_log`,
    `0008` presente. El texto plano vivió en un `mktemp -d` borrado al terminar.
  - **3.2 terminada.**

- **3.4, keystore y primer build** (2026-11-16).
  - Keystore PKCS12 generado con el `keytool` de Android Studio: alias `grimoire`, RSA 4096,
    `CN=Grimoire, O=Kuraos`, válido del 2026-11-16 al 2054-04-03 (10 000 días). Vive en
    `~/.gradle/grimoire-release.jks`; la contraseña, aleatoria y nunca impresa, en
    `~/.gradle/gradle.properties` (`GRIMOIRE_RELEASE_STORE_FILE` y `_STORE_PASSWORD`). Las
    variables de entorno con el mismo nombre mandan sobre el archivo: así se firma con la copia
    externa sin tocar nada más.
  - **Huella SHA-256 del certificado:**
    `e744e9a0b1f5d53889347f35e391717c1035fe33fe100ef0c7f77c3f48bf8cc9`.
  - `assembleRelease` con el JDK 21 (`JAVA_HOME='C:\Program Files\Java\jdk-21'`; Gradle 8.14.3
    no corre con el JDK 25 de Android Studio, como en la fase 0). `apksigner verify
    --print-certs` da esa huella. Sin las dos variables, el release sale sin firmar.
  - Ojo: el release no es `debuggable`, así que `adb shell run-as` deja de servir para mirar la cola
    o los borradores en los dispositivos. Antes de desinstalar la debug se mira con `run-as` por
    última vez.
  - Faltan: copia de Johan en sus dos lugares, el build firmado con la copia externa instalado
    encima y el paso de los dos dispositivos.

  - **Bug encontrado al probar el teléfono** (2026-11-16): marcas hechas en el teléfono no salían
    al recargar la web del PC; aparecieron solo después de marcar desde el PC, que además mostró un
    error. El teléfono enviaba al instante (marca y desmarca del 19:19:40 UTC en producción). La
    causa estaba en la web: la caché restaurada de disco conservaba su `dataUpdatedAt` y, con el
    `staleTime` de 30 s, una recarga dentro de ese plazo no le preguntaba al servidor. Reproducido
    en local (recarga a los 25 s: «0 cumplidos» y ninguna petición). El error fue marcar en el PC un
    hábito que el teléfono ya había marcado; ese rechazo forzó el refresco. Arreglo: `restore()`
    invalida lo hidratado sin pedirlo (`refetchType: 'none'`); se pide al montar la vista o al
    volver la red, y sin señal se sigue viendo. Test nuevo en `queue.test.ts`; en local, recarga a
    los pocos segundos de una marca del «teléfono»: «2 cumplidos hoy».
    Desplegado con el «sí» de Johan: versión `1609cb0c` (2026-11-16, 19:29 UTC). `/health` 200,
    `/` y `/habitos` navegando 200 `text/html`, `/habits` sin bearer 401, y el `index-*.js`
    publicado trae el `refetchType: 'none'`. El release del teléfono se recompiló con el arreglo y
    se instaló encima (misma huella).
