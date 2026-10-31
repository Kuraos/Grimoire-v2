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
3. **Una sola mutación** (salvo categorías), clave `['api']`, con `setMutationDefaults`: la función, el
   `scope` que las ejecuta en orden y la invalidación viven en el cliente de queries, no
   en los hooks. Una mutación restaurada de disco no tiene hook que le diga qué hacer.
4. **Efectos de pantalla** (toasts, XP, nivel) en `AppProvider`, y los errores en un solo
   punto (`onApiError`).
5. Un **401** borra el token y vuelve a pedirlo, sin tocar la cola. Un fallo de red no toca
   el token.

## Cola sin conexión (2.1.6)

Lo que la 2.1.6 cambió respecto a la decisión de arriba:

- **Las vistas no esperan.** `enqueue` no devuelve promesa: la de una mutación pausada no
  termina, y la restaurada no tiene. El resultado llega por `onSyncResults`, en un lote por
  vaciado, y los errores por `onApiError`. Se atiende en el `onSuccess` de `MutationCache`
  y no en el de los defaults, porque es el único que recibe la mutación (y su edad).
- **Conexión:** `onlineManager` es `red && token`; la red viene de `@capacitor/network`, no
  de `navigator.onLine`. Un 401 lo apaga y la cola se pausa; un token válido la reanuda.
- **Reintentos:** sin respuesta, 5xx, 408 y 429 reintentan sin límite, con espera de hasta
  60 s. Un 5xx permanente bloquea la cola a propósito (perder datos es peor), con un aviso.
  Otro 4xx es definitivo: se muestra y la cola sigue.
- **Persistencia propia** con `@capacitor/preferences`, sin `query-persist-client`: su
  `maxAge` por defecto borraría una cola de más de 24 h y su throttle puede perder lo último.
  Se guarda todo lo `pending` (también lo que iba en vuelo: repetirlo es idempotente) y lo
  rechazado. Las lecturas de la lista también, para poder abrir sin señal: nombres de hábitos
  en claro en el dispositivo. El token sigue en el Keystore.
- **La vista optimista es derivada** (`applyQueue`), no un cambio en la caché: sobrevive a
  refetches y reinicios y no hay nada que revertir. Racha, constancia y XP no se predicen.
- **Categorías fuera de la cola:** repetir su `DELETE` da 404, así que no cumplen el contrato.
- La cola solo se vacía con la app abierta: no hay sincronización en segundo plano.

## Consecuencias

- Vaciar la cola invalida las queries en pantalla una sola vez, al final: 3–4 lecturas
  por vaciado. Cabe en los 100 000 requests diarios; si pesara, se afina por ruta.
- Una dependencia nueva, a cambio de no escribir a mano caché, reintentos, pausa sin
  conexión y el estado de las mutaciones.
