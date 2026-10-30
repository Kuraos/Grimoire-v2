import { useSyncExternalStore } from "react";

/**
 * Cuánto se mueve la app. Una sola fuente de verdad para Motion y para el CSS.
 *
 * Antes cada hoja preguntaba al sistema con `@media (prefers-reduced-motion)` y
 * Motion lo hacía por su cuenta. Funcionaba, pero la única voz era la de
 * Windows, y en Windows esa preferencia es «Efectos de animación», un
 * interruptor de todo el sistema que mucha gente apaga por rendimiento sin
 * pensar en ninguna app concreta. Con él apagado, Grimoire no se movía nunca, y
 * nada lo decía.
 *
 * Ahora la app resuelve la preferencia y la deja en `<html data-motion>`:
 * `reduced` o `full`. El CSS cuelga de ese atributo y Motion de este módulo.
 * «system» sigue siendo el valor por defecto: quien pide movimiento reducido
 * por accesibilidad lo sigue teniendo sin tocar nada.
 */
export type MotionPref = "system" | "full" | "reduced";

export const MOTION_KEY = "grimoire.motion.v1";
const QUERY = "(prefers-reduced-motion: reduce)";

const listeners = new Set<() => void>();

export function readPref(): MotionPref {
  try {
    const v = window.localStorage.getItem(MOTION_KEY);
    return v === "full" || v === "reduced" ? v : "system";
  } catch {
    return "system";
  }
}

function systemReduces(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/** La preferencia ya resuelta contra el sistema. */
export function resolveReduced(pref: MotionPref, system: boolean): boolean {
  return pref === "reduced" || (pref === "system" && system);
}

export function isReduced(): boolean {
  return resolveReduced(readPref(), systemReduces());
}

function apply() {
  document.documentElement.dataset.motion = isReduced() ? "reduced" : "full";
  listeners.forEach((l) => l());
}

export function setPref(pref: MotionPref) {
  try {
    window.localStorage.setItem(MOTION_KEY, pref);
  } catch {
    /* sin almacenamiento la preferencia dura la sesión: no merece un error */
  }
  apply();
}

/** Se llama una vez, antes del primer render, para que el CSS no anime ni un
 *  fotograma con el valor equivocado. Sigue al sistema si cambia en caliente. */
export function initMotionPref() {
  apply();
  if (typeof window.matchMedia === "function") {
    window.matchMedia(QUERY).addEventListener("change", apply);
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, isReduced);
}

export function useMotionPref(): MotionPref {
  return useSyncExternalStore(subscribe, readPref);
}
