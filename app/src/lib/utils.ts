import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `cn` de shadcn, que es lo que importan los componentes de Bklit y Kokonut UI.
 *
 * tailwind-merge va en v2 a propósito: la v3 sólo entiende Tailwind 4. Y hay que
 * enseñarle nuestra escala: `text-2xs` no es un peldaño de Tailwind, así que sin
 * esto lo toma por un color —`text-[color]`— y `cn("text-2xs", "text-text-muted")`
 * tiraría el tamaño creyendo que eran dos colores en conflicto.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs"] }],
      rounded: [{ rounded: ["card"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
