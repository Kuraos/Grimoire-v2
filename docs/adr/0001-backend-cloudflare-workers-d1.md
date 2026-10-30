# ADR 0001 — Backend en Cloudflare Workers + D1 (plan gratis)

Estado: aceptado (2026-10-29)

## Contexto

La v1 corre el backend como sidecar en el PC, así que el celular no puede usarla. Johan
la quiere en Android (teléfono y tablet) y en el PC, la usa con datos móviles y no quiere
pagar servidor. Necesita una sola fuente de verdad: varias bases sincronizándose entre sí
es justo lo que no queremos construir.

## Opciones revisadas (planes gratis a octubre de 2026)

| Opción | Problema |
|---|---|
| VPS | Cuesta (~USD 5/mes). Descartado por requisito. |
| Render free | El servicio duerme tras 15 min (~1 min en despertar); la Postgres gratis expira a los 30 días y se borra. |
| Supabase free | 500 MB, se pausa tras una semana de baja actividad, sin backups automáticos en el plan gratis. Además obliga a pasar la lógica a SQL/RLS/Edge Functions. |
| PC propio + Tailscale | Depende de que el PC esté prendido. |
| **Cloudflare Workers + D1** | Ver abajo. |

## Decisión

Workers + D1. Límites del plan gratis (docs de Cloudflare, oct. 2026): 100 000
requests/día, 10 ms de CPU por request (no cuenta la espera de D1), 128 MB de memoria,
50 subrequests por invocación, Worker de hasta 64 MiB sin comprimir, 5 cron triggers.
D1: 500 MB por base, 5 M filas leídas y 100 000 escritas por día, time travel de 7 días.
No duerme ni expira. Johan ya usa Cloudflare en ventas-app.

El mismo Worker sirve la versión web estática (gratis e ilimitado para assets), que se
usa en el PC desde el navegador.

## Consecuencias

- Sin conexión no hay escrituras al servidor: el cliente necesita caché y cola de
  mutaciones (ver ADR 0004 para por qué los IDs lo permiten).
- Hay que montar un export programado de D1 como respaldo más allá de los 7 días de
  time travel (tarea de una fase posterior).
- Los límites del plan gratis cambian. Releerlos antes de decisiones que dependan de ellos.
