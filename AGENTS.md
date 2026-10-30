# Grimoire v2 — instrucciones para agentes

Este archivo es la fuente de verdad para cualquier agente (Claude Code, Hermes, Codex).
`CLAUDE.md` solo lo importa. Si algo aquí contradice lo que te piden, dilo antes de hacerlo.

## Qué es

Grimoire es un CRM de vida personal con gamificación y estética gótica: hábitos con
rachas y XP, tareas, pomodoro, diario, check-ins, calendario, finanzas («Erario»),
entrenamiento, revisiones semanales y logros. Un solo usuario (Johan).

La v1 (`github.com/Kuraos/Grimoire`, v0.10.0) es una app de escritorio Tauri con un
backend FastAPI empaquetado como sidecar y SQLite local. No funciona en el celular.
La v2 existe para que funcione en **Android (teléfono y tablet Samsung)** y en el PC,
con datos móviles, **sin pagar servidor**.

La v1 es la referencia de comportamiento: sus reglas de dominio (XP, niveles, rachas,
cadencias, logros) se portan, no se reinventan. Repo local: `C:\Users\jbust\OneDrive\Desktop\Proyectos\Grimoire`
(lógica en `backend/services.py`, `backend/constants.py`, `backend/achievements.py`,
`backend/routers/`; tests en `backend/tests/test_api.py`).

## Arquitectura

```
Android (APK Capacitor) / tablet / PC (navegador o PWA)
        │ HTTPS + Authorization: Bearer <token>
        ▼
Cloudflare Worker (Rust, workers-rs + axum)  ── sirve también la web estática
        │
        ▼
D1 (SQLite)   respaldo: time travel 7 días + export programado
```

Decisiones y su porqué en `docs/adr/` (0001–0007). Orden de trabajo en `docs/ROADMAP.md`. No contradigas un ADR sin escribir otro que lo reemplace.

```
api/
  crates/domain/   Rust puro: reglas de negocio. Sin I/O, sin reloj, sin worker. cargo test nativo.
  crates/worker/   Adaptador delgado: rutas axum, D1, auth, zona horaria. Compila a wasm32.
  migrations/      SQL de D1 (wrangler d1 migrations)
app/               React + TypeScript + Vite + Tailwind, empaquetado con Capacitor (fase 1+)
scripts/           Python: migración de datos desde la v1 (más adelante)
docs/adr/          Decisiones de arquitectura
docs/DESIGN_SYSTEM.md  Sistema visual y adaptación a pantallas
docs/ROADMAP.md    Fases, mínimo para dejar la v1, congelamiento de la v1
docs/tasks/        Tareas por fase, con criterio de terminado
```

## Invariantes (no negociables)

1. **`domain` es puro.** Ninguna función de `domain` lee el reloj, la base de datos ni el
   entorno. «Hoy» entra como parámetro (`NaiveDate`). Si una regla necesita datos, el
   worker los consulta y se los pasa. Así toda la lógica se prueba con `cargo test` sin wrangler.
2. **IDs: UUID generados en el cliente** (texto, v7 preferido). Nunca autoincrementales.
   Permite crear registros sin conexión y reintentar sin duplicar (ADR 0004).
3. **Tiempo** (ADR 0004): los instantes se guardan en UTC como texto RFC 3339
   (`2026-10-29T23:46:28Z`). El día al que pertenece una marca se guarda **explícito**
   en una columna `local_date` (`YYYY-MM-DD`, zona `America/Bogota`), calculado en el
   momento de marcar. Las rachas y cadencias trabajan solo con `local_date`.
4. **Dinero en enteros** (centavos u otra unidad mínima), nunca float.
5. **Esquema solo con migraciones nuevas.** Nunca editar una migración ya aplicada.
6. **Autorización en el servidor.** Toda ruta salvo `/health` exige el token. El token
   vive como secreto de wrangler (`wrangler secret put GRIMOIRE_TOKEN`) y en local en
   `api/crates/worker/.dev.vars`, que está en `.gitignore`.
7. **El repo es público.** Nada de secretos, tokens, IDs de cuenta sensibles ni datos
   personales reales (diario, finanzas) en el código, seeds o tests.
8. **Plan gratis de Cloudflare.** 10 ms de CPU por request, 100 000 requests/día,
   50 subrequests por invocación (agrupa consultas con `batch`). Si algo no cabe, dilo;
   no lo resuelvas pasando a un plan pago.
9. **Reglas temporales** (vidas, penalizaciones, todo lo que dependa de que pase un día):
   función pura del dominio; lo irreversible solo se asienta tras 2 días de gracia;
   nada de crons que decidan (ADR 0005).
10. **Paridad con la v1 verificada:** cada módulo se porta contra tests de
   caracterización (`docs/tasks/caracterizacion-v1.md`). Las diferencias permitidas
   están listadas allí.
11. Código, tablas y columnas en inglés. Interfaz, mensajes al usuario y docs en español
   de Colombia (tuteo).

## Interfaz: se porta, no se recrea

La identidad visual de la v1 (tokens, fuentes, ~60 componentes propios, la librería
de gráficos `bklit`) se copia al repo **antes** de construir cualquier vista
(`docs/tasks/fase-1-port-ui.md`). Reglas en `docs/DESIGN_SYSTEM.md`; léelo antes de
tocar UI.

1. **Antes de crear un componente, búscalo** en `app/src/components` y en la v1. Si
   existe, se usa o se adapta. Un componente nuevo se justifica en el mensaje de commit.
2. **Adaptar = layout, densidad e interacción.** Clases responsive (mobile-first,
   escritorio detrás de `lg:`), áreas táctiles, hoja inferior en vez de modal. No se
   cambian colores, tipografías, escalas ni la forma de un componente.
3. **Nada de valores sueltos:** colores en `var(--gr-*)`, tamaños y radios de la escala.
   Ni hexadecimales ni `text-[17px]`.
4. **Componentes visuales sin datos.** Reciben props; no llaman a la API. La capa de
   datos vive aparte (`app/src/api`, hooks), para no arrastrar el cliente de la v1
   (IDs enteros, `127.0.0.1:8000`).
5. **Una vista no está terminada sin capturas** en teléfono (≈393×852) y tablet
   horizontal (≈1280×800).

## Comandos de verificación

Una tarea solo está terminada si esto pasa. Corre lo que aplique y pega la salida relevante.

```bash
# desde api/
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p grimoire-domain
cargo test -p grimoire-worker   # SQL de escrituras concurrentes contra SQLite (rusqlite)
# el worker compila a wasm (target wasm32-unknown-unknown ya instalado)
cd crates/worker && npx wrangler dev        # API local con D1 local en http://localhost:8787
npx wrangler d1 migrations apply grimoire --local
```

`app/` (cuando exista): `npm run typecheck && npm test && npm run build`.

## Forma de trabajar

- Construye por pasos y valida cada uno antes de generalizar. Un módulo de punta a punta
  antes de abrir el siguiente.
- Al portar una regla de la v1, lee primero la función original y sus comentarios: muchos
  documentan bugs ya arreglados (p. ej. el denominador de `scheduled_occasions`, el piso de
  XP en 0, la racha leída antes de insertar). Porta también esos casos como tests.
- Los tests de `domain` se escriben a partir de casos concretos de la v1 (entrada → salida
  esperada), no a partir de la implementación nueva.
- `workers-rs` es pre-1.0 y su API cambia. Antes de usar una API suya, verifica contra la
  versión fijada en `Cargo.lock` (docs.rs/worker) en vez de confiar en ejemplos viejos.
- Entorno: Windows 11 nativo, sin WSL. Rutas con `/` para herramientas nativas.
- No hagas `wrangler deploy` ni toques la base remota sin que Johan lo pida.
