# ADR 0008 — Capa de datos del cliente

Estado: aceptado (2026-10-31)

## Contexto

La vista de Hábitos es la primera con datos reales, y Tareas y Diario siguen el mismo
patrón. La 2.1.6 agrega una cola sin conexión genérica (`docs/tasks/fase-2-habitos.md`) que
tiene que sobrevivir a cerrar la app, en orden, con repeticiones idempotentes (ADR 0004).
`AGENTS.md` exige que los componentes visuales no llamen a la API.

## Decisión

1. **TanStack Query** para lecturas y escrituras. Las lecturas son hooks por recurso en
   `app/src/api/` (`habits.ts`, `categories.ts`, `user.ts`); el cliente HTTP es
   `client.ts`, con el token en el Keystore (`SecureStorage`).
2. **Una escritura es un dato:** `ApiRequest = { method, path, body }`, JSON puro, con los
   ids del cliente (y el `local_date` de una marca) ya adentro. Se construye una sola vez
   al actuar, en funciones puras (`habitRequests`). Reintentar manda lo mismo.
3. **Una sola mutación**, clave `['api']`, con `setMutationDefaults`: la función, el
   `scope` que las ejecuta en orden y la invalidación viven en el cliente de queries, no
   en los hooks. Una mutación restaurada de disco no tiene hook que le diga qué hacer.
4. **Efectos de pantalla** (toasts, XP, nivel) en quien llama, con la promesa de
   `mutateAsync`. Los errores se informan en un solo punto (`onApiError`).
5. Un **401** borra el token y vuelve a pedirlo. Un fallo de red no toca el token.

## Qué le queda a la 2.1.6

Persistir la caché de mutaciones, reanudarlas (`resumePausedMutations`), la actualización
optimista y marcar lo pendiente. Nada de eso cambia `ApiRequest` ni las llamadas de las
vistas. Una mutación restaurada pierde su promesa, así que el resultado de una marca
sincronizada tarde (XP, logros) lo tendrá que atender el `onSuccess` de los defaults.

## Consecuencias

- Toda escritura invalida las queries en pantalla: 3–4 lecturas por marca. Cabe en los
  100 000 requests diarios; si pesara, se afina por ruta.
- Una dependencia nueva, a cambio de no escribir a mano caché, reintentos, pausa sin
  conexión y el estado de las mutaciones.
