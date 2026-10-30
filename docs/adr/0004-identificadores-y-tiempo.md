# ADR 0004 — UUID generados en el cliente y día local explícito

Estado: aceptado (2026-10-29)

## Contexto

La v1 usa enteros autoincrementales y fechas *naive* en la zona de la máquina
(`backend/tz.py`). Con un servidor en la nube y clientes que pierden señal, eso falla:

- Un ID entero lo asigna el servidor, así que el cliente no puede crear un registro sin
  conexión ni reintentar sin riesgo de duplicarlo.
- Un Worker corre en UTC. «Hoy» y «esta semana» calculados en el servidor sin zona
  corren las rachas: una marca a las 8 p. m. en Bogotá ya es «mañana» en UTC.

D1 es SQLite: no tiene `timestamptz`.

## Decisión

1. **IDs**: UUID en texto, generados por el cliente (v7 preferido, ordena por tiempo).
   El servidor acepta el ID que llega y un reintento con el mismo ID es idempotente.
2. **Instantes**: texto RFC 3339 en UTC (`...Z`). Se usan para auditoría y orden.
3. **Día de una marca**: columna `local_date TEXT` (`YYYY-MM-DD`) calculada al marcar,
   en la zona del usuario (`America/Bogota` por defecto, configurable con la variable
   `GRIMOIRE_TZ`). Rachas, cadencias, «ya marcado hoy» y metas semanales se calculan solo
   sobre `local_date`, nunca derivando el día de un instante.
4. **Semanas**: ISO, lunes a domingo, como en la v1 (`_week_monday`).
5. El dominio recibe «hoy» como `NaiveDate`; el worker lo calcula a partir del reloj y la zona.

## Consecuencias

- Una marca hecha sin conexión conserva su día real aunque llegue al servidor después.
- La migración desde la v1 debe convertir sus fechas naive (hora local de Bogotá) a UTC
  y rellenar `local_date` con la fecha local original.
