# Fase 1.1 — Portar el sistema visual de la v1 (sin cambios)

Depende de: tarea 0.4 (existe `app/` con Vite + React + TS + Capacitor).

Objetivo: que el repo tenga la identidad visual completa de la v1 **antes** de que
nadie construya una vista, para que los agentes la reutilicen en vez de reinventarla.
Es una tarea mecánica: copiar, quitar lo que es de Tauri, hacer que compile. **No se
rediseña nada aquí.**

Origen: `C:\Users\jbust\OneDrive\Desktop\Proyectos\Grimoire\frontend` (v0.10.0).

## Qué se copia

| Origen (v1, `frontend/`) | Destino (v2, `app/`) |
|---|---|
| `src/theme.css`, `src/index.css`, `src/fonts.css`, `src/styles/` | igual |
| `src/theme-tokens.ts` (+ su test) | igual |
| `tailwind.config.js`, `postcss.config.*` | igual |
| `public/fonts/` | igual |
| `src/components/ui/`, `src/components/charts/`, `src/components/bklit/`, `src/components/TablerIcon.tsx` | igual |
| `src/components/layout/` salvo `SettingsModal.tsx` | igual |
| `src/lib/utils.ts`, `src/motion-pref.ts`, `src/burst.ts`, `src/sounds.ts`, `src/polar.ts`, `src/fuzzy.ts` (+ tests) | igual |
| Dependencias de `package.json`: `@tabler/icons-react`, `@visx/*`, `d3-array`, `d3-shape`, `motion`, `@number-flow/react`, `clsx`, `tailwind-merge`, `react-router-dom` | mismas versiones mayores |

## Qué NO se copia

- `src/updater.ts` y las dependencias `@tauri-apps/*` (en Android las actualizaciones
  son otro mecanismo, ADR 0003).
- `src/components/layout/SettingsModal.tsx` (mezcla Tauri, backups locales y vault de
  Obsidian; se rehace después).
- `src/api/` y `src/pages/` (la API es otra; las páginas se portan una por una en
  fases siguientes, ya adaptadas a pantallas).

## Acoplamiento con la API vieja

Revisado en la v1: solo 4 archivos de componentes importan la API —
`charts/DiaryVolume.tsx`, `layout/TopBar.tsx`, `ui/QuestsCard.tsx` y
`layout/SettingsModal.tsx` (este último no se copia). Además revisar los contextos y
hooks que los componentes usen (`context.tsx`, `pomodoro-context.tsx`, `hooks/`):
si llaman a la API, tampoco se copian en esta tarea. En cada
uno, sacar la llamada a la API: el componente recibe los datos por props, y la
llamada queda como `TODO(fase-N)` en el sitio que lo use. No reescribir el cliente
viejo.

## Criterio de terminado

- Un commit con solo la copia (`fase-1: portar sistema visual de la v1 sin cambios`) y
  otro, aparte, con los ajustes mínimos para compilar. Así el historial muestra qué se
  tocó.
- `npm run typecheck`, `npm test` (los tests portados de la v1 pasan) y `npm run build`
  en verde.
- Una página temporal `/_muestrario` que renderiza con datos de ejemplo (inventados,
  nada personal): `Card` en sus tres rangos, `XPBar`, `HabitCardGothic`, `HoldButton`,
  `BudgetRail`, `Sigil`, `Modal`, un gráfico de `charts/`. Captura de esa página en
  el navegador a 393 px y a 1280 px de ancho. Se espera que el teléfono se vea mal:
  la captura documenta el punto de partida, no se arregla en esta tarea.
- Cero hexadecimales nuevos fuera de `theme.css` / `theme-tokens.ts`
  (`rg "#[0-9a-fA-F]{6}" app/src` solo encuentra esos dos archivos y los gráficos que
  ya los tenían en la v1).

## Después de esta tarea

La primera vista a adaptar es la **barra de navegación** (barra inferior en teléfono,
`Sidebar` en `lg:`), según `docs/DESIGN_SYSTEM.md` → «Navegación». Luego Hábitos, que
es la que ya tiene API en la fase 0.
