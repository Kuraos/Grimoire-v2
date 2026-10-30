# ADR 0005 — Reglas que dependen del paso del tiempo

Estado: aceptado (2026-10-29)

## Contexto

Verificado en la v1 (`backend/routers/user.py::evaluate_streaks`, llamado desde
`App.tsx` al abrir la app): al abrir, se recorren los días sin evaluar desde
`users.last_streak_eval` (máximo 14). Por cada día:

- si algún hábito diario que tocaba ese día rompió su racha (no se marcó y sí se había
  marcado su ocasión anterior) → se pierde una vida, o `STREAK_BREAK_XP_PENALTY` de XP si
  no quedan vidas;
- si se marcaron todos los hábitos que tocaban → se recupera una vida (hasta `MAX_LIVES`).

Luego se escribe `last_streak_eval = hoy`. **La evaluación es irreversible**: una marca
de un día ya evaluado no devuelve la vida.

En la v1 eso no importaba: un solo dispositivo, siempre con su base. En la v2 sí:

1. Marcas un hábito sin señal a las 11 p. m. en el teléfono.
2. A las 8 a. m. abres la tablet: evalúa el día anterior, ve el hábito sin marcar y te
   quita una vida.
3. Al rato el teléfono recupera señal y sube la marca (con su `local_date` de ayer,
   ADR 0004). La vida no vuelve.

## Decisión

1. **El cálculo es una función pura del dominio**, un *fold* día a día:
   `evaluate_days(estado_inicial, días, hábitos, marcas) -> (estado_final, eventos)`,
   donde el estado es `{ vidas, penalización_acumulada }` y los eventos son
   `VidaPerdida`, `VidaRecuperada`, `PenalizaciónXP` con su día y hábitos. Mismas
   reglas que la v1, portadas con tests de caracterización.
2. **Un día solo se asienta cuando ya no pueden llegar marcas tardías.** Ventana de
   gracia: el día `D` se asienta cuando `hoy >= D + 2` (en `America/Bogota`). Los días
   asentados se guardan (vidas en el punto de control, `settled_through`, y la
   penalización de XP se escribe en `xp_log` solo al asentar). Es lo único irreversible.
3. **Los días no asentados se calculan al consultar**, partiendo del último punto de
   control. Lo que muestra la app (vidas, «racha rota ayer») es provisional y se
   corrige solo si llega una marca tardía. No se escribe nada.
4. **No hay cron que tome decisiones.** Asentar ocurre perezosamente en cualquier
   request que lo necesite (idempotente, por `settled_through`). Un cron diario, si
   se agrega, solo sirve para recordatorios.
5. El servidor **acepta marcas con `local_date` pasada** dentro de la ventana de gracia
   (hoy, ayer, anteayer). Fuera de la ventana se rechazan con 409 y un mensaje claro.

## Consecuencias

- Una marca hecha sin conexión dentro de las 48 h siguientes cuenta como si hubiera
  llegado a tiempo.
- La pérdida de una vida se avisa igual que en la v1 (al abrir), pero puede
  «deshacerse» si la marca llega tarde. El aviso debe decir que es provisional mientras
  el día no se asiente.
- El cálculo provisional cubre como máximo 2 días más el que corre: barato dentro de los
  10 ms de CPU.
- Diferencia con la v1: allí el día se evaluaba en cuanto pasaba; aquí la penalización
  definitiva llega con un día de retraso. Es deliberado.
- **En la v1, con uso diario, las vidas casi nunca funcionaban.** Lo encontró la
  caracterización (`docs/tasks/caracterizacion-v1.md`, «Hallazgos», escenario
  `racha_rota`). Al terminar, la v1 escribe `last_streak_eval = hoy`, que significa
  «evaluado hasta ayer». La siguiente evaluación empieza en `last_streak_eval + 1`, así
  que el día de una evaluación nunca se evalúa. Como la app evalúa al abrirse, todo
  día en que se abrió quedaba sin evaluar: ni se perdía ni se recuperaba la vida. Solo
  contaban los días en que no se abrió la app. **No se porta.** En la v2,
  `settled_through` es el último día ya asentado, sin ambigüedad: el siguiente en
  asentarse es `settled_through + 1`. Las vidas van a funcionar de verdad, y con uso
  diario se van a perder y recuperar mucho más que en la v1. Los goldens de vidas
  graban la v1 tal cual; el test de la v2 marca esa diferencia y no la compara.
- Este diseño aplica a cualquier otra regla temporal que aparezca al portar (misiones,
  logros por días consecutivos, cierre de mes del Erario): asentar con gracia, calcular
  lo provisional al consultar.
