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
- Usa el mismo mecanismo que los tests de la v1 (`backend/tests/test_api.py`): base
  temporal vía `GRIMOIRE_DB` y `fastapi.testclient.TestClient(main.app)`.
- **Congela el reloj.** La v1 importa `today`/`now` por nombre en cada módulo
  (`from tz import today as _today`), así que hay que parchear cada sitio que lo use
  (`services._today`, `routers.user._today`, etc.), no solo `tz.today`. Verificar con
  `rg "from tz import"` en el backend de la v1 que no quede ninguno sin parchear.
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
- **Diferencias permitidas**, cada una documentada en el propio test con referencia al
  ADR: redondeo de XP en mitades exactas (fase-0.md, tarea 0.1) y momento en que se
  asienta una penalización (ADR 0005: la v2 la asienta con 2 días de gracia, la v1 al
  día siguiente; se compara el estado ya asentado).
- Cualquier otra diferencia es un bug de la v2, o un bug de la v1 que se decide
  conscientemente no portar: en ese caso se anota en «Hallazgos» de la fase y en el test.
