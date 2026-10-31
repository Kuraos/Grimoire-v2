# Tests de caracterización contra la v1

Objetivo: que «se comporta igual que la v1» sea algo que se verifica, no algo que se
cree. Antes de portar cada módulo se graban las respuestas reales de la v1 a escenarios
fijos y la v2 tiene que reproducirlas.

Se hace **una vez por módulo**, justo antes de portarlo. La primera vez (Hábitos) se
construye la herramienta; después solo se agregan escenarios.

## Herramienta: `scripts/characterize_v1.py`

- Python, se ejecuta con el intérprete del entorno de la v1
  (`C:\Users\jbust\OneDrive\Desktop\Proyectos\Grimoire\backend\.venv`) y `-I`, pasando la
  ruta del backend de la v1 como argumento. No se copia código de la v1 a este repo.
  ```
  <v1>/backend/.venv/Scripts/python.exe -I scripts/characterize_v1.py <v1>/backend
  ```
- Usa el mismo mecanismo que los tests de la v1 (`backend/tests/test_api.py`): base
  temporal vía `GRIMOIRE_DB` y `fastapi.testclient.TestClient(main.app)`. **Cada
  escenario corre en su propio subproceso** (mismo intérprete, `-I`) con su base
  temporal: `database.py` crea el engine al importar, así que cambiar `GRIMOIRE_DB`
  dentro del mismo proceso no cambia de base. El padre solo recoge el JSON del hijo.
- La v1 siembra 4 hábitos de ejemplo en una base vacía (`main.seed`); el hijo los borra
  con SQL y verifica que `GET /habits?include_archived=true` devuelve `[]` antes del
  primer paso.
- **Congela el reloj** sustituyendo `tz.datetime` por una subclase con `now()` fijo.
  Parchear los alias uno por uno (`services._today`, `routers.user._today`…) **no
  basta**: `models.py` usa `default=_now` en las columnas, y SQLAlchemy guarda el objeto
  función al importar. Como todos los `from tz import now as _now` son el mismo objeto
  `tz.now`, y este busca `datetime` en `tz` en cada llamada, un solo parche cubre alias
  y defaults. El hijo verifica que ningún módulo de la v1 tenga una función de `tz`
  distinta de `tz.now`/`today`/`to_naive` y que el `created_at` de cada hábito creado
  sea el instante congelado. Los únicos relojes fuera de `tz` (`rg` sobre el backend):
  `main.py:71` (`date.today()` en una migración que no corre en base nueva) y
  `backup.py:82` (mtime de archivos).
- Sin `GRIMOIRE_TZ`: el reloj congelado ya es la hora de pared en `America/Bogota`, y
  en Windows `ZoneInfo` exige `tzdata`, que el `.venv` de la v1 no tiene.
- Cada escenario es una secuencia de pasos `{ "hoy": "2026-03-02", "llamada": ..., }` y
  la salida guarda la respuesta relevante de cada paso. Para hábitos, las marcas se
  hacen avanzando el reloj día a día, porque la v1 marca siempre «ahora».
- Salida: `api/crates/domain/tests/golden/<modulo>/<escenario>.json` con entrada y
  respuestas esperadas. **Datos inventados**: nada del diario ni de las finanzas reales.

## Escenarios mínimos para Hábitos

1. Diario simple, 10 días seguidos: racha, XP por marca (con multiplicador desde el
   día 7), nivel y título.
2. Diario L–V: semana completa, fin de semana sin marcar, lunes siguiente. La racha no
   se rompe; `evaluate-streaks` no quita vida el sábado.
3. Racha rota: marca, salto de un día, evaluación al día siguiente → vida perdida.
   Repetir hasta 0 vidas → penalización de XP.
4. Día perfecto con 2 hábitos → vida recuperada (hasta el máximo).
5. Semanal 2×/semana: semana incompleta, semana completa, tercera marca rechazada.
6. Deshacer una marca (`DELETE /habits/{id}/complete`): XP devuelto, piso en 0.
7. Logros que dispara marcar hábitos (`first_blood` y los de racha).

## Cómo los usa la v2

- `grimoire-domain` tiene un test que lee cada golden y reproduce la secuencia con las
  funciones puras, comparando campo por campo.
- Los goldens graban la v1 tal cual, aunque haya bugs. Lo que la v2 hace distinto
  está en la tabla de abajo; el test lo señala en el paso afectado, con referencia a
  esta tabla, y no compara ese campo.
- Cualquier otra diferencia es un bug de la v2, o un bug de la v1 que se decide
  conscientemente no portar. En ese caso se agrega una fila a la tabla y se anota en el
  test.

### Diferencias permitidas

Decididas por Johan el 2026-10-30, salvo las dos primeras, que vienen de fase-0 y del
ADR 0005.

| # | Diferencia | v1 (lo que graba el golden) | v2 | Motivo |
|---|---|---|---|---|
| 1 | Redondeo del multiplicador | `round()` de Python en float: mitades al par, con error binario (`25 × 1.10 → 28`, `30 × 1.35 → 40`) | Puntos básicos enteros, mitades hacia arriba (`40.5 → 41`) | ±1 XP solo en mitades exactas, a cambio de no depender de float (fase-0, 0.1). Ningún golden actual cae en una mitad. |
| 2 | Cuándo se asienta un día (vidas y penalización) | Al día siguiente, de forma irreversible | Al aceptar marcas de hasta anteayer, `D` se asienta cuando `hoy >= D + 3`; antes es provisional | Una marca sin conexión puede llegar tarde y debe contar (ADR 0005). Se compara el estado ya asentado. |
| 3 | Día que se evalúa | El día en que corrió `evaluate-streaks` nunca se evalúa (`last_streak_eval + 1`) | Se asientan todos los días: el siguiente es `settled_through + 1` | Es un bug: con uso diario las vidas casi nunca cambiaban (ADR 0005, Consecuencias). Afecta a `racha_rota`, `dia_perfecto`, `diario_lv` y `deshacer`. |
| 4 | Logros informados al marcar | `achievement_unlocked`: solo el primero desbloqueado | Lista de todos los logros desbloqueados por la marca | Los demás se desbloqueaban sin aviso (`logros`, 03-08: `total_discipline`). |
| 5 | `total_xp` del hábito tras deshacer con XP en 0 | Se registra 0 en `xp_log` y la concesión original sigue sumando | Deshacer anula lo que concedió la marca, aunque el XP del usuario ya esté en 0 | El total del hábito contaba XP de una marca borrada (`deshacer`, 03-16: 80 con 70 de marcas vivas). |
| 6 | `streak` en la respuesta de marcar | Racha previa + 1, la que decide el multiplicador, aunque la marca no cierre la semana | La racha real tras la marca, la misma que devuelve `GET` | La respuesta contradecía al `GET` en semanales (`semanal_2x`, 03-04 y 04-20). El **XP pagado no cambia**: sigue usando previa + 1, como en la v1. |
| 7 | `iron_constancy` con hábitos semanales | Cuenta semanas, con la racha real | **Igual que la v1** | Se conserva. Va aquí para que no se «arregle» por error. |
| 8 | Racha que dispara los logros de racha | La más larga entre **todos** los hábitos activos, recalculada en cada marca (`_max_current_streak`) | La del hábito que se marca | Marcar un hábito no cambia la racha de los demás, y leerlas todas costó 48–53 ms de CPU por marca (`docs/tasks/fase-2-habitos.md`, 2.1.3). Solo difiere si otro hábito ya tiene la racha y el logro sigue bloqueado; lo cubre el backfill del ADR 0006. Ningún golden lo muestra. |

## Hallazgos

Comportamientos de la v1 grabados tal cual en los goldens (v1 en `f85381f`). Lo que
se decidió sobre cada uno está en «Diferencias permitidas»; lo que no aparece allí se
porta igual.

- **Hábitos** (2026-10-30): goldens en `api/crates/domain/tests/golden/habits/`.
  - **`evaluate-streaks` nunca evalúa el día en que corrió** (`routers/user.py:66-72`).
    Guarda `last_streak_eval = hoy` («evaluado hasta ayer») y la siguiente llamada
    empieza en `last_streak_eval + 1`, saltándose ese día. Con una evaluación diaria
    —lo que hace la app al abrirse— no se evalúa ningún día: nunca se pierde ni se
    recupera una vida. En la práctica solo cuentan los días en que no se abrió la app.
    Los tests de la v1 no lo ven porque siempre ponen `last_streak_eval = NULL` antes de
    evaluar. Evidencia: `racha_rota` (el 03-11 se rompe la racha y las evaluaciones del
    11, 12 y 13 no lo cobran; los días marcados, por ser de evaluación, no devuelven la
    vida, así que un solo hábito llega a 0 vidas) y `dia_perfecto` (el 03-05 y el 03-08
    no cuentan). Los escenarios de vidas evalúan solo en ciertos días por esto. ADR 0005
    redefine la evaluación como función pura; conviene decidir allí si se porta.
  - **Multiplicador en la primera marca semanal** (ya anotado en fase-0, 0.1): la marca
    paga con racha previa + 1 aunque no cierre la semana. `semanal_2x`, 2026-04-20: con 6
    semanas cumplidas, la 1.ª marca de la semana 8 paga 22 XP (× 1.10) y responde
    `streak: 7`, mientras `GET /habits/{id}` sigue diciendo 6.
  - **`streak` de la respuesta de marcar ≠ racha real en semanales**: es la previa + 1
    usada para el multiplicador. `semanal_2x`, 03-04: la marca responde `streak: 1` y el
    `GET` siguiente, `streak: 0` (1 de 2 no cierra la semana).
  - **`iron_constancy` con semanales cuenta semanas**, y con la racha real, no con la del
    multiplicador: en `semanal_2x` se desbloquea el 04-23 (2.ª marca de la semana 8), no
    el 04-20, que ya pagó con racha 7. La descripción del logro dice «7 días».
  - **Solo se informa un logro por marca**: `achievement_unlocked` es el primero de la
    lista. En `logros`, el 03-08 se desbloquean `iron_constancy` y `total_discipline`,
    pero la respuesta solo trae el primero; el otro solo aparece en `GET /achievements`.
  - **El piso en 0 deja `total_xp` del hábito inflado**: si el deshacer se aplica con XP
    en 0, se registra 0 en `xp_log` y la concesión original queda. `deshacer`, 03-16:
    `xp_earned: 0` y el `total_xp` de Lectura sigue contando los 10 XP de la marca
    borrada (80 con 7 marcas vivas).
  - Con 0 vidas, cada día roto cuesta 15 XP y la respuesta trae `life_lost: false` con
    `xp_penalty > 0` (`racha_rota`, 03-10). La penalización también respeta el piso:
    `deshacer`, 03-16, cobra 150 y deja el XP en 0.
  - Ningún escenario cae en una mitad exacta del redondeo (diferencia permitida de
    fase-0, 0.1): los pagos con multiplicador son 22, 110, 120 y 135.
