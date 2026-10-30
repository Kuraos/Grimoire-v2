import { useId, type ReactNode } from "react";
import { LayoutGroup, motion } from "motion/react";

/**
 * Selector de pestañas con una placa que viaja de una opción a otra. Adaptado
 * del «smooth tab» de Kokonut UI, sin el panel que se arrastra: en escritorio
 * nadie desliza el contenido con el ratón.
 *
 * Calendario, Estadísticas y Tareas tenían cada uno el mismo selector escrito a
 * mano —el mismo borde, el mismo fondo activo con dos tonos distintos de
 * morado—, y las pestañas de modalidad del entrenamiento una cuarta forma. Ahora
 * es uno. Arcano: es navegación, estado del sistema.
 */
export function Segmented<T extends string>({ value, onChange, options, size = "md", label }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: "sm" | "md";
  /** Nombre del grupo para lectores de pantalla. */
  label?: string;
}) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div role="tablist" aria-label={label} className="relative flex rounded-md border border-[var(--border-accent)] p-0.5">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              role="tab"
              aria-selected={on}
              title={o.title}
              onClick={() => onChange(o.value)}
              className={`relative inline-flex items-center gap-1.5 rounded-sm font-display transition-colors ${
                size === "sm" ? "px-2 py-0.5" : "px-3 py-1"
              } text-xs ${on ? "text-[var(--gr-arcane-bright)]" : "text-[var(--text-muted)] hover:text-[var(--text-body)]"}`}
            >
              {on && (
                <motion.span
                  layoutId="placa"
                  className="absolute inset-0 rounded-sm bg-[var(--purple-deep)]"
                  transition={{ type: "spring", stiffness: 480, damping: 36 }}
                />
              )}
              <span className="relative inline-flex items-center gap-1.5">{o.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
