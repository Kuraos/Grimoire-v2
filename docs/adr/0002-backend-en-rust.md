# ADR 0002 — Backend en Rust (workers-rs + axum), dominio puro aparte

Estado: aceptado (2026-10-29). Pendiente de validar en la fase 0.

## Contexto

Workers admite JavaScript/TypeScript, Python (GA desde septiembre de 2026, FastAPI vía
`workers.asgi`) y Rust (crate `worker`, compila a WebAssembly). La v1 está en Python, pero
SQLAlchemy/aiosqlite no funcionan sobre D1 (se consulta por binding), así que la capa de
datos se reescribe en cualquier caso.

## Decisión

Rust con `worker` (features `d1`, `http`, `axum`) y axum para las rutas. Separado en dos crates:

- `grimoire-domain`: reglas puras (XP, niveles, títulos, multiplicador de racha,
  cadencias, rachas, logros). Sin dependencias de `worker`. Se prueba con `cargo test`
  nativo.
- `grimoire-worker`: rutas, SQL contra D1, autenticación, zona horaria. Delgado.

Tipos compartidos con el frontend: generar TypeScript desde los structs (`ts-rs` o
similar) en vez de escribirlos dos veces.

## Por qué

- Holgura frente al límite de 10 ms de CPU del plan gratis. Python corre sobre Pyodide y
  ese margen era la principal incógnita; en Rust/Wasm se espera amplio (por confirmar en
  la fase 0).
- Johan está aprendiendo Rust y este es un dominio que conoce.
- El dominio puro aísla la lógica de un SDK que todavía es pre-1.0.

## Costos aceptados

- Se traduce toda la lógica de la v1, no solo la capa de datos.
- SQL a mano (`prepare().bind()`); no hay ORM maduro para D1 en Rust.
- `worker` es pre-1.0 (0.8.x en oct. 2026) y su README aún marca D1 como «alpha».
- Fricción con `Send` en axum (los objetos de JS no son `Send`); el SDK trae
  `send::SendWrapper` y `#[worker::send]`.

## Criterio para revertir

Si en la fase 0 el binding de D1 o axum sobre workers-rs resultan inutilizables, se
reconsidera TypeScript (Hono) conservando el mismo diseño de dominio puro.
