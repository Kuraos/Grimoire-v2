# ADR 0007 — Lectura acotada del historial de marcas

Estado: aceptado (2026-10-29)

## Contexto

En la tarea 0.3 (`docs/tasks/fase-0.md`, «Hallazgos») se midió el worker desplegado con
un seed sintético de 10 hábitos y 9 388 marcas, unos 3 años de uso
(`scripts/bench_seed.py`):

| Request | CPU mediana | Filas leídas de D1 |
|---|---|---|
| `GET /habits` | 22–25 ms (20/20 sobre 10 ms) | ≈ 18 820 |
| `POST /habits/{id}/complete` | 6 ms (máx. 12 ms) | ≈ 1 061 |

Ambas rutas leen **todo** el historial: una fila de D1 por marca, deserializada objeto
por objeto (`results::<T>()` con `serde_wasm_bindgen`). El CPU escala con las filas
(~9 400 → ~22 ms; ~1 000 → ~6 ms), y las rutas que no leen historial gastan ~1 ms. El
costo está en el **patrón de lectura**, no en el lenguaje: el ADR 0002 se mantiene.

Hay dos límites del plan gratis en juego (ADR 0001, invariante 8):

1. **10 ms de CPU por request.** `GET /habits` ya lo excede hoy con 3 años.
2. **5 000 000 filas leídas por día en D1**, contadas como filas *escaneadas*. Con
   ≈ 18 820 filas por `GET /habits`, alcanzan para unas 265 consultas al día, y el
   número baja cada día porque el historial solo crece (~3 500 marcas al año con 10
   hábitos).

## Decisión

1. **Lectura compacta.** Las marcas se leen agrupadas por hábito, una fila por hábito
   con `group_concat(local_date)` (`GROUP BY habit_id`). El worker separa las fechas en
   Rust. Así baja el cruce JS→wasm de una fila (un objeto) por marca a una por hábito;
   con ~10 filas, leerlas como objetos o como arreglos (`raw()`) ya no importa, y `raw()`
   no existe dentro de `batch` en workers-rs 0.8.7. Por sí sola no reduce las filas
   leídas: D1 sigue escaneando cada marca del índice.

2. **Ventana reciente, ampliada solo en el borde.** Se leen solo las marcas con
   `local_date >= hoy − 90 días`. El índice `(habit_id, local_date)` resuelve ese rango
   sin escanear lo anterior. Con esas marcas, el dominio calcula la racha y dice si es
   **exacta** o si **llegó al borde**: la siguiente unidad hacia atrás (día programado o
   semana ISO) empieza antes de la ventana, así que podría estar marcada. Solo para los
   hábitos en el borde se lee su historial completo, en una segunda consulta.

   - **Tamaño de 90 días.** Cubre los umbrales del multiplicador hasta 60 (7, 14, 30, 60)
     y unas 13 semanas de un semanal; solo una racha de más de ~3 meses obliga a
     ampliar. Con 10 hábitos son ≈ 900 filas por `GET /habits`, unas 5 500 consultas al
     día, y la cifra **no** crece con los años.
   - **Ampliación directa al historial completo**, no por duplicación (90 → 180 → …):
     es una consulta más y no un bucle. Un hábito con una racha muy larga paga su
     historial completo en cada lectura. Si eso llegara a pesar, se amplía por
     duplicación, sin cambiar el dominio.
   - Para validar una marca (`complete`), la ventana debe incluir la semana de la marca
     (meta semanal) y el día de creación del hábito no se lee del historial: 90 días ≫ 9
     (gracia de 2 días + semana).

3. **La regla del borde vive en el dominio**, como función pura con tests: dadas las
   marcas desde `from`, la cadencia y «hoy», devuelve la racha exacta o «en el borde».
   El worker solo decide qué volver a leer.

4. Cada request escribe en el log las filas leídas de D1 (`meta.rows_read`), para
   vigilar la cuota con `wrangler tail`.

## Alternativa descartada: guardar la racha calculada

Guardar en `habits` la racha actual (y actualizarla al marcar) haría la lectura O(1),
pero:

- **Choca con el ADR 0005.** Las marcas pueden llegar tarde y desordenadas, con
  `local_date` pasada dentro de la ventana de gracia. Una marca de anteayer que tapa un
  hueco cambia la racha de hoy: el contador guardado habría que **recalcularlo** desde
  las marcas en cada llegada tardía, que es justo la lectura que queríamos evitar. Si
  no se recalcula, queda mal sin que nadie lo note.
- **La racha depende de «hoy», no solo de las marcas.** Con el margen del día en curso,
  la racha de ayer sigue «viva» hoy y muere mañana sin que llegue ninguna escritura. Un
  valor guardado envejece solo; habría que invalidarlo por calendario, con un cron
  (descartado en el ADR 0005) o en cada lectura (otra vez, leer el historial).
- **Rompe la idempotencia (ADR 0004).** Un reintento de la misma marca no debe tocar
  nada. Con un contador, el reintento tendría que distinguirse con cuidado de una marca
  nueva para no sumar dos veces. Hoy la racha es una función de un *conjunto* de fechas
  (insertar dos veces la misma no cambia nada), y eso se perdería.
- **Dos fuentes de verdad.** Las marcas ya son la verdad; la racha guardada sería una
  caché sin invalidación confiable, y la migración desde la v1 (ADR 0006) tendría que
  calcularla y mantenerla coherente.

La ventana conserva la racha como función pura de marcas + hoy y acota el costo.

## Consecuencias

- El CPU y las filas leídas de las lecturas habituales quedan acotados por la ventana,
  no por los años de uso. Solo las rachas de más de 90 días cuestan más.
- `best_streak` (mejor racha histórica) no puede calcularse con la ventana: cuando una
  vista la necesite, será una lectura completa de **un** hábito o un valor que se
  asienta con gracia (ADR 0005), no algo de cada `GET /habits`.
- Toda regla nueva que lea historial (estadísticas, logros por días consecutivos)
  debe declarar cuánta ventana necesita.
