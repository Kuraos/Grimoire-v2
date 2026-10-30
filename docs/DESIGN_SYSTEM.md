# Grimoire — sistema visual

Heredado de la v1 (`Kuraos/Grimoire`, `DESIGN_SYSTEM.md`) sin cambios de identidad.
Lo nuevo de la v2 es la sección **Adaptación a pantallas**, al final.

**La fuente de verdad es el código**, no este documento: la paleta vive en
`app/src/theme.css`, las escalas en `app/tailwind.config.js`, las clases de
componente en `app/src/index.css` y los valores resueltos para gráficos en
`app/src/theme-tokens.ts`. Si un valor de aquí discrepa del código, manda el código
y se corrige este archivo.

Sirve para dos cosas: que un agente entienda **por qué** el código es como es antes
de tocarlo, y pegarlo como contexto en una herramienta de diseño antes de pedir
mockups de una vista.

---

## Qué es Grimoire

CRM de vida personal con gamificación: hábitos, tareas, Pomodoro, diario,
finanzas ("el erario"), logros y XP. Un solo usuario, en Android (teléfono y
tablet, APK) y en el PC (navegador). Sin modo claro: la app es oscura y punto.

## La tesis

Manuscrito iluminado: **pan de oro sobre vitela oscura.**

El gótico no está en "usar morado", está en la **tensión térmica**: un sustrato
violeta-frío y profundo contra dos acentos que se oponen —arcano frío para el
estado del sistema, dorado cálido para la recompensa. El carácter vive en el
sustrato y los bordes; la legibilidad, en la tinta. Así el contraste sube en vez
de bajar.

---

## La ley del acento

Es la regla que más define el aspecto de la app. Antes de pintar algo de color,
decidir a cuál de los tres pertenece:

| | |
|---|---|
| **Dorado** | lo que el usuario se ganó: XP, niveles, logros desbloqueados, rachas activas, misiones cumplidas |
| **Arcano** | sistema: navegación activa, foco, selección, acción primaria |
| **Tinta** | todo lo demás: títulos, prosa, datos, metadata, iconos inactivos |

**Si el oro aparece donde no hay recompensa, deja de significar recompensa.** Ya
pasó una vez: la barra del Pomodoro usaba el degradado de XP y terminaba en
dorado sin serlo.

Corolario del módulo de finanzas: **el dinero no es oro.** Un saldo sano es
circunstancia, no mérito. Los montos van en tinta tabular y el estado de un
presupuesto en los colores semánticos. En todo el erario hay exactamente dos
dorados legítimos —una meta de ahorro alcanzada y un mes cerrado—, y los dos son
metas que el usuario fijó y cumplió, igual que una misión.

---

## Tokens

Copiados de `theme.css`. Todos los pares tinta/sustrato están verificados por
cómputo a WCAG AA (≥ 4.5:1); el peor par es oxblood sobre surface-raised, 4.57:1.

```css
/* Sustrato: violeta-negro frío, en pasos perceptibles */
--gr-void:            #07060c;  /* fondo de la app — el abismo */
--gr-chrome:          #100c1c;  /* sidebar y topbar */
--gr-surface:         #1e1830;  /* cards y paneles — vitela oscura */
--gr-surface-raised:  #2b2340;  /* inputs, hover, dropdowns */
--gr-surface-sunken:  #040308;  /* overlays de modal, pozos */

/* Tinta: cálida sobre tierra fría */
--gr-ink-bright:      #f2ede6;  /* 15.1:1 s/surface — títulos */
--gr-ink:             #d2cbdb;  /* 11.2:1 — cuerpo */
--gr-ink-dim:         #a49db5;  /*  6.8:1 — metadata */
--gr-ink-faint:       #a29ab3;  /*  6.1:1 — deshabilitado */

/* Acento ARCANO (frío): estado, foco, navegación activa */
--gr-arcane:          #a98bf0;
--gr-arcane-bright:   #c6b0ff;
--gr-arcane-deep:     #2d1c56;  /* fondo de badge */
--gr-arcane-deep-hover: #3d2670;

/* Acento DORADO (cálido): recompensa, XP, logros */
--gr-gilded:          #dcae5c;
--gr-gilded-bright:   #f0cd8a;
--gr-gilded-deep:     #3a2a0c;

/* Estados semánticos, coherentes con la estética */
--gr-verdigris:       #5aa885;  /* éxito — cobre envejecido */
--gr-verdigris-deep:  #123422;
--gr-amber:           #d4913c;  /* advertencia */
--gr-amber-deep:      #3d290c;
--gr-oxblood:         #dc6b84;  /* peligro */
--gr-oxblood-deep:    #3f1522;

/* Bordes: neutro estructural; el acento sólo marca foco/estado */
--gr-edge:            #3d3358;
--gr-edge-strong:     #52456f;
--gr-edge-focus:      #a98bf0;
--gr-edge-danger:     #6e2c3f;
--gr-edge-inner:      rgba(201, 180, 255, 0.09);  /* filo interior */

/* Barra de XP: del arcano al dorado = progreso hacia la recompensa */
--gr-xp-from:         #3b2a6e;
--gr-xp-to:           #dcae5c;

/* Categorías (datos) — fría y saturada, no pastel */
--gr-cat-fisico:      #5aa885;
--gr-cat-academico:   #a98bf0;
--gr-cat-idioma:      #6f93e0;
--gr-cat-proyecto:    #cf7ba6;
--gr-cat-tcg:         #dcae5c;
--gr-cat-otro:        #9a90b5;
--gr-cat-personal:    #63a9c4;
--gr-cat-trabajo:     #b8807f;

/* Rareza de logros: culmina en dorado */
--gr-tier-common:     #a49db5;
--gr-tier-rare:       #6f93e0;
--gr-tier-epic:       #b57ded;
--gr-tier-legendary:  #dcae5c;
```

### La escalera de elevación tiene techo

`abismo → cromo → superficie → elevado`, con saltos de 1.04 · 1.10 · 1.15.
Superficie contra abismo queda en 1.18; borde contra superficie en 1.48.

**No se puede subir más sin bajar `ink-faint` de AA.** Es un límite medido, no una
preferencia. Si un mockup quiere más separación entre card y fondo, hay que subir
también la tinta tenue y revalidar los pares — no es un ajuste libre.

---

## Escalas

### Tipografía — seis peldaños con función asignada

```
2xs  11px   rótulo (versalitas, tracking 0.02em)
xs   13px   suelo de interfaz — botones, metadata
sm   15px   cuerpo de card
base 16px   prosa
xl   24px   iluminación (Cinzel)
3xl  44px   rúbrica (título de vista, Cinzel, uppercase, tracking 0.05em)
```

La cifra (34px) no es un peldaño suelto: es el rol `.gr-figure`, que además fija
`tabular-nums`. Los 56px del temporizador a pantalla completa son el único tamaño
por encima de la escala, y es deliberado.

**`fontSize` y `borderRadius` reemplazan la escala de Tailwind, no la extienden.**
`text-lg` y `rounded-xl` no existen en este proyecto. Un mockup que los use está
fuera de sistema.

### Familias

- **Cinzel** (`--gr-font-display`) — sólo encabezados y énfasis. Uppercase.
- **Inter** (`--gr-font-ui`) — UI, datos, metadata. Todo lo demás.
- **Spectral** (`--gr-font-prose`) — prosa extensa: diario, descripciones.

**Cinzel no tiene cifras tabulares.** `tabular-nums` no le hace nada, y a 56px
`11:11` mide 6px menos que `25:00`. Cualquier número que cambie va en Inter
tabular; Cinzel es para títulos y nombres.

### Radios — cuatro peldaños más la píldora

```
xs    2px   marcas de datos: celdas de heatmap, carriles
sm    4px   piezas pequeñas: casillas, días, anillo de foco
md    6px   controles: botón, input, select
lg   10px   superficies: card, modal, popover
pill 9999   píldoras
```

`0` y `50%` no son peldaños, son formas (la marginalia sin caja, el pulgar del
deslizador).

### Movimiento

```
--gr-dur-state:   170ms  hover / focus / active
--gr-dur-enter:   240ms  entrada de card o modal
--gr-dur-reward:  420ms  gamificación
--gr-ease-out:    cubic-bezier(0.22, 1, 0.36, 1)
--gr-ease-reward: cubic-bezier(0.34, 1.36, 0.5, 1)   /* leve rebase */
```

Todo movimiento se apaga bajo `prefers-reduced-motion`. Quedan fuera a propósito
las transiciones de color y opacidad, que no son movimiento.

---

## Rangos de superficie

Una card no puede significar tres cosas. El Dashboard tenía ocho con idéntico
fondo, borde, radio y padding —seis de ellas de 444px exactos— así que ningún
elemento pesaba más que otro y el ojo no tenía por dónde entrar.

- **`rubric`** — lo que el día exige. **Una por vista.** Degradado
  `152deg, surface-raised 0% → surface 78%`, borde `edge-strong`, padding
  `18px 20px`, filo de oro arriba (`inset 0 1px 0 rgba(220,174,92,.30)`), título
  en Cinzel 15px. Es el único sitio de toda la app donde el oro toca una
  superficie en vez de un dato.
- **`leaf`** — la card estándar, por defecto. `surface`, borde `edge`, radio
  `lg`, padding `14px 16px`, filo interior. Título en Inter 11px versalitas
  `ink-dim`.
- **`marginalia`** — cifras de contexto; pierde la caja y deja sólo un filete
  superior. Fondo transparente, `border-top` y nada más.

El rótulo de card se encoge a 11px a propósito: **el contenido tiene que pesar
más que su etiqueta.** Es la inversión que hace legible la jerarquía.

---

## Componentes de referencia

### Card

```tsx
<section className="card card-rubric">
  <div className="section-title mb-3">
    <span className="text-[var(--text-muted)]">{icon}</span>
    <span className="section-title-text">Foco de hoy</span>
    <span className="normal-case ml-3">3 / 5</span>
  </div>
  {children}
</section>
```

`rank="rubric"` mueve la cifra junto al título (`ml-3`) en vez de al borde
(`ml-auto`): a 250px de distancia leían como dos cosas, no como una.

### Barra de XP — todo dorado, el arcano no entra

```tsx
<div className="card">
  <div className="mb-1.5 flex flex-wrap items-center gap-3">
    <div className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gr-gilded)]
                    bg-[var(--gr-gilded-deep)] px-2.5 py-[3px] font-display text-sm
                    text-[var(--gr-gilded-bright)]">
      <IconSkull size={14} /> Nivel 12
    </div>
    <span className="text-xs italic text-[var(--text-body)]">Escriba de la Vigilia</span>
    <span className="ml-auto text-xs text-[var(--gr-gilded)]">+180 XP hoy</span>
  </div>
  <div className="my-1.5 h-2 overflow-hidden rounded bg-[var(--bg-elevated)]">
    <div className="h-full rounded"
         style={{ width: "64%",
                  background: "linear-gradient(90deg, var(--xp-from), var(--xp-to))" }} />
  </div>
  <div className="flex justify-between text-xs tabular text-[var(--text-body)]">
    <span>4.820 XP · 320/500 al siguiente nivel</span>
    <span>Nivel 13</span>
  </div>
</div>
```

### Carril de presupuesto — el mismo objeto, sin una gota de oro

```tsx
const FILL = { ok: "var(--gr-verdigris)", warn: "var(--gr-amber)", over: "var(--gr-oxblood)" };

<div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
  <span className="flex items-center gap-1.5 text-[var(--text-body)]">
    <span className="inline-block h-2 w-2 rounded-xs" style={{ background: color }} />
    Mercado
  </span>
  <span className="tabular whitespace-nowrap text-[var(--text-muted)]">
    <span className="font-semibold text-[var(--text-primary)]">$412.000</span> / $500.000
  </span>
</div>
<div className="h-[7px] w-full overflow-hidden rounded-xs bg-[var(--bg-elevated)]"
     role="meter" aria-valuenow={82} aria-valuemin={0} aria-valuemax={100}>
  <div className="h-full rounded-xs transition-[width]"
       style={{ width: "82%", background: FILL[state] }} />
</div>
```

Un carril lleno significa "te lo gastaste todo". Pintarlo con el degradado de XP
premiaría en oro justo el peor mes. Además, **el estado se lee sin color**: la
cifra de la derecha dice lo mismo, porque un carril rojo y uno verde a 7px de
alto son la misma forma para quien no distingue los dos tonos.

### Botón e input

```css
.btn      { fondo elevated · borde edge-strong · radio md · Inter 13px 500
            uppercase tracking .06em · padding 7px 14px }
.btn:hover{ borde pasa a focus, texto a ink-bright }
.btn-primary { fondo arcane-deep · borde focus · texto arcane-bright }
.input    { fondo elevated · borde edge · radio md · 15px · padding 8px 11px
            · width 100% · en foco el borde pasa a arcane }
```

El acento morado se gana su lugar: `btn-primary` es **una sola acción por vista.**

### Foco

```css
outline: 2px solid var(--gr-edge-focus);
outline-offset: 2px;
border-radius: var(--gr-radius-sm);
```

Uniforme en todo lo interactivo, sin excepciones.

---

## Reglas duras para cualquier propuesta

1. **Oro sólo donde hay recompensa.** Y sobre superficie, sólo en la rúbrica.
2. **Una `rubric` por vista.** Si dos cosas gritan, no grita ninguna.
3. **Nada fuera de las escalas.** Seis tamaños, cinco radios. Si el mockup pide
   un séptimo, el mockup está mal o hay que discutir la escala explícitamente.
4. **La escalera de elevación está en su techo.** Más contraste de superficie
   exige revalidar la tinta.
5. **Ningún estado se comunica sólo con color.** Siempre hay cifra, icono o texto
   que dice lo mismo.
6. **Números que cambian: Inter tabular.** Nunca Cinzel.
7. **Colores en `var()`, jamás hexadecimales**, excepto en gráficos: recharts
   emite atributos de presentación SVG y necesita valores resueltos, que salen de
   `app/src/theme-tokens.ts`.
8. **Nada de selectores compuestos** tipo `select.input`: suben la especificidad
   a 0-1-1 y ganan a las utilidades de Tailwind. Ya anuló durante meses el
   `w-auto` de los filtros de Tareas.

---

## Cómo usar este brief

1. Pegarlo entero al abrir la sesión de diseño.
2. **Adjuntar capturas de la vista real** que se quiere rediseñar. Sin eso, la
   propuesta es para una app imaginada. El minicalendario llevaba desde el commit
   inicial pintando un solo día y pasó dos auditorías completas de contraste,
   escala, radios y desbordes sin que saltara ninguna: apareció en la primera
   captura de pantalla. Medir y mirar no son lo mismo.
3. Pedir **mockup**, no wireframe: la estructura ya está decidida, lo que se
   explora es composición y jerarquía.
4. Lo que salga es **propuesta visual, no código para pegar.** Traducir a los
   tokens y a las escalas antes de tocar el repo.

---

## Adaptación a pantallas (nuevo en la v2)

La v1 se diseñó para una ventana de escritorio de 980 px como mínimo, con mouse y
teclado. La v2 corre en tres contextos. **Adaptar es cambiar layout, densidad e
interacción; nunca la identidad.** Tokens, escalas, rangos de superficie, la ley del
acento y las reglas duras de arriba aplican igual en todos los tamaños.

### Contextos y puntos de corte

Se usan los breakpoints estándar de Tailwind. No se inventan otros.

| Contexto | Ancho | Breakpoint | Uso real |
|---|---|---|---|
| **Teléfono** (vertical) | < 768 px | base (sin prefijo) | Registrar rápido: marcar hábitos, tareas, pomodoro |
| **Tablet vertical** | 768–1023 px | `md:` | Secundario; debe funcionar, no se optimiza |
| **Tablet horizontal** | ≥ 1024 px | `lg:` | **Contexto principal de la tablet.** Se comporta como el escritorio de la v1 |
| **PC** (navegador) | ≥ 1280 px | `xl:` | Igual que la v1 |

Consecuencia práctica: la v1 ya usa `lg:` en ~30 sitios, y la tablet horizontal cae
justo ahí. **El layout de escritorio de la v1 es el layout `lg:` de la v2.** El
trabajo nuevo es escribir la versión base (teléfono) de cada vista, mobile-first,
dejando la de escritorio detrás de `lg:`.

### Navegación

- **Teléfono y tablet vertical:** barra inferior fija con **Inicio, Hábitos, Tareas,
  Pomodoro y Más**. «Más» abre una hoja inferior con el resto, en este orden: Diario,
  Calendario, Entrenamiento, Erario, Estadísticas, Logros, Revisión semanal, Ajustes.
  El destino activo va en arcano (es sistema, no recompensa), con icono **y** rótulo
  de 11 px: nunca solo icono.
- **Tablet horizontal y PC:** la `Sidebar` de la v1, sin cambios de estructura.
- Las rutas son las mismas en todos los tamaños (`/habitos`, `/tareas`…). Solo cambia
  el contenedor de navegación.
- `CommandPalette` solo existe con teclado físico (`lg:` y en adelante). En teléfono no
  se muestra ni se reemplaza.
- `PomodoroIsland`: en teléfono queda anclada encima de la barra inferior mientras
  hay un pomodoro activo.

### Interacción táctil

- **Área táctil mínima de 44 × 44 px** para todo lo que se toca, aunque el elemento
  visible sea más pequeño (casillas de 18 px, celdas de heatmap): se agranda el área
  con padding o un pseudo-elemento, **no** el dibujo. Así no se rompe la escala.
- **Nada depende del hover.** Lo que en la v1 aparece al pasar el mouse (tooltips de
  gráficos, acciones de fila) en táctil se obtiene así: tooltips de gráfico con toque
  o arrastre sobre la serie; acciones de fila visibles, en menú contextual por
  pulsación larga o en el detalle del elemento. Los estilos `hover:` pueden quedarse
  para el PC, pero ninguna función puede vivir solo ahí.
- `HoldButton` ya es un patrón táctil: se conserva tal cual.
- Gestos de deslizar (swipe para completar o borrar) quedan **fuera** hasta que haya
  una razón concreta; si se agregan, siempre con alternativa visible.
- Nada de zoom accidental: inputs con al menos 16 px de texto en teléfono (si no,
  el navegador hace zoom al enfocar). Es la única desviación permitida de la escala:
  `text-base` en lugar de `text-sm` dentro de inputs en la base, `lg:text-sm` arriba.

### Superficies en pantalla angosta

- **Modales → hoja inferior** en teléfono (ocupa el ancho, sube desde abajo, cierra
  deslizando hacia abajo o con el botón atrás de Android). En `lg:` siguen siendo el
  `Modal` centrado de la v1. Es el **mismo componente** con dos presentaciones, no dos
  componentes.
- Grillas de cards: una columna en teléfono, las columnas de la v1 en `lg:`. El orden
  en una columna sigue la jerarquía: la `rubric` de la vista va primero.
- Tablas anchas (Erario, Entrenamiento): en teléfono se vuelven lista de filas
  apiladas, no tabla con scroll horizontal.
- El temporizador a pantalla completa (56 px) se mantiene: es el caso de uso estrella
  del teléfono.
- Gráficos: mismo componente, menos densidad (menos ticks, etiquetas abreviadas); no
  se cambia el tipo de gráfico por pantalla.

### Bordes del sistema

- `viewport-fit=cover` y márgenes con `env(safe-area-inset-*)` para la barra de
  estado, la cámara y la barra de gestos. La barra inferior suma
  `safe-area-inset-bottom` a su padding.
- La barra de estado de Android en el color `--gr-chrome`.
- El botón atrás de Android cierra primero hojas y modales abiertos; solo después
  navega hacia atrás.

### Cómo se verifica una vista

Una vista adaptada se da por terminada con **capturas reales** en dos tamaños:
teléfono (≈ 393 × 852) y tablet horizontal (≈ 1280 × 800), adjuntas al commit o al PR.
Se revisa en la captura: nada se corta ni desborda, áreas táctiles de 44 px, una
sola `rubric`, oro solo donde hay recompensa. Medir y mirar no son lo mismo.
