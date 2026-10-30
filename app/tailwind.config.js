/** @type {import('tailwindcss').Config} */

// Los nombres de color no llevan valores propios: apuntan a los tokens `gr-*`
// de theme.css. Antes esta config mantenía una paleta paralela y obsoleta
// (#0c0b0e donde el tema decía #07060c, #9b7fc4 donde decía #a98bf0) que ningún
// componente usaba — cuarenta tokens esperando a que alguien escribiera
// `bg-bg-surface` y obtuviera el color equivocado. Ahora una clase utilitaria y
// una `var()` escrita a mano pintan exactamente lo mismo.
//
// Nota: al ser `var()` y no un valor resoluble, los modificadores de opacidad
// (`bg-accent/50`) no funcionan sobre estos nombres. Para transparencias, usa
// `color-mix()` o un token con alfa propio.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // `fontSize` y `borderRadius` REEMPLAZAN la escala de Tailwind en vez de
    // extenderla: si se quedan en `extend`, los peldaños que no defino siguen
    // existiendo con los valores por defecto y se pueden usar sin querer. Fuera
    // de `extend`, `text-lg` o `rounded-xl` simplemente no existen y la clase se
    // queda muda — visible en revisión, en vez de un tamaño fuera de sistema.
    fontSize: {
      "2xs": ["11px", { lineHeight: "1.45", letterSpacing: "0.02em" }], // rótulo
      xs: ["13px", { lineHeight: "1.5" }], // suelo de interfaz
      sm: ["15px", { lineHeight: "1.55" }],
      base: ["16px", { lineHeight: "1.6" }], // prosa
      xl: ["24px", { lineHeight: "1.2" }], // iluminación — Cinzel
      "3xl": ["44px", { lineHeight: "1.02" }], // rúbrica — título de vista
      // La cifra (34px) no es un peldaño suelto: es el rol `.gr-figure`, que
      // además fija tabular-nums. Tenerlo también aquí eran dos formas de
      // decir lo mismo.
    },
    borderRadius: {
      none: "0",
      xs: "var(--gr-radius-xs)",
      DEFAULT: "var(--gr-radius-sm)",
      sm: "var(--gr-radius-sm)",
      md: "var(--gr-radius-md)",
      lg: "var(--gr-radius-lg)",
      card: "var(--gr-radius-lg)",
      full: "var(--gr-radius-pill)",
    },
    extend: {
      colors: {
        bg: {
          base: "var(--gr-void)",
          primary: "var(--gr-void)",
          surface: "var(--gr-surface)",
          elevated: "var(--gr-surface-raised)",
          overlay: "var(--gr-surface-sunken)",
          deep: "var(--gr-surface-sunken)",
          chrome: "var(--gr-chrome)",
        },
        border: {
          DEFAULT: "var(--gr-edge)",
          strong: "var(--gr-edge-strong)",
          accent: "var(--gr-edge-strong)",
          focus: "var(--gr-edge-focus)",
          glow: "var(--gr-edge-focus)",
          danger: "var(--gr-edge-danger)",
        },
        accent: {
          DEFAULT: "var(--gr-arcane)",
          strong: "var(--gr-arcane-bright)",
          deep: "var(--gr-arcane-deep)",
        },
        purple: {
          main: "var(--gr-arcane)",
          muted: "var(--gr-ink-dim)",
          deep: "var(--gr-arcane-deep)",
        },
        // Recompensa: XP, logros, rachas. Faltaba por completo en esta config.
        gilded: {
          DEFAULT: "var(--gr-gilded)",
          bright: "var(--gr-gilded-bright)",
          deep: "var(--gr-gilded-deep)",
        },
        text: {
          primary: "var(--gr-ink-bright)",
          body: "var(--gr-ink)",
          muted: "var(--gr-ink-dim)",
          faint: "var(--gr-ink-faint)",
        },
        xp: {
          from: "var(--gr-xp-from)",
          to: "var(--gr-xp-to)",
        },
        // Clases que traen los gráficos de Bklit. Apuntan al puente `--chart-*`
        // de theme.css, que a su vez apunta a la paleta.
        chart: {
          label: "var(--chart-label)",
          "tooltip-background": "var(--chart-tooltip-background)",
          "tooltip-foreground": "var(--chart-tooltip-foreground)",
          "tooltip-muted": "var(--chart-tooltip-muted)",
        },
        state: {
          success: "var(--gr-verdigris)",
          "success-bg": "var(--gr-verdigris-deep)",
          warning: "var(--gr-amber)",
          "warning-bg": "var(--gr-amber-deep)",
          danger: "var(--gr-oxblood)",
          "danger-bg": "var(--gr-oxblood-deep)",
        },
      },
      fontFamily: {
        display: "var(--gr-font-display)",
        ui: "var(--gr-font-ui)",
        prose: "var(--gr-font-prose)",
        body: "var(--gr-font-ui)",
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
