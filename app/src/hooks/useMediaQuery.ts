import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** El `lg:` de Tailwind (1024 px): tablet horizontal y PC, con el layout de la v1. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
