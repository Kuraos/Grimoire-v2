import { ReactNode } from "react";
import { useIsDesktop } from "../../hooks/useMediaQuery";
import { createPortal } from "react-dom";
import { IconX } from "@tabler/icons-react";
import { motion } from "motion/react";
import { motionTokens } from "../../theme-tokens";

/**
 * Todo diálogo se monta en `document.body`, no donde se escribe.
 *
 * `position: fixed` se resuelve contra el viewport **salvo** que algún
 * antepasado tenga `transform`, y la animación de entrada de las vistas
 * (`gr-enter`, que desplaza 6px) le da uno a la raíz de cada página durante y
 * después de la animación. Con el modal dentro del árbol de la vista, «fijo»
 * pasaba a significar «fijo respecto a la página», y el diálogo aparecía fuera
 * de la pantalla o recortado por el scroll de `main`.
 *
 * En un portal el problema no puede volver: no hay antepasado que transformar.
 */
export function Overlay({ onClose, children, align = "center" }: {
  onClose: () => void;
  children: ReactNode;
  /** `start` deja el diálogo arriba y con scroll propio, para los largos. */
  align?: "center" | "start";
}) {
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: motionTokens().state }}
      /* Marca de «hay un diálogo abierto». La lee el atajo de Espacio en App:
         sin ella, la barra arrancaba el Pomodoro por debajo del modal. */
      data-overlay=""
      /* Teléfono: hoja inferior pegada al borde. lg: el diálogo centrado de la v1. */
      className={`fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto lg:p-4 ${
        align === "start" ? "lg:items-start lg:py-8" : "lg:items-center"
      }`}
      style={{ background: "rgba(10,8,16,0.72)" }}
      onClick={onClose}
    >
      {children}
    </motion.div>,
    document.body,
  );
}

/**
 * Un solo componente, dos presentaciones (DESIGN_SYSTEM → «Superficies en
 * pantalla angosta»): en teléfono es una hoja inferior que se cierra
 * deslizándola hacia abajo; desde lg:, el modal centrado de la v1.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const desktop = useIsDesktop();
  return (
    <Overlay onClose={onClose}>
      {/* Sólo entrada. La salida pediría un AnimatePresence en cada una de las
          diecinueve llamadas, que hoy desmontan el modal con un `&&`. */}
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        drag={desktop ? false : "y"}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 1 }}
        onDragEnd={(_, info) => { if (info.offset.y > 80) onClose(); }}
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-lg p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:max-w-md lg:rounded-lg lg:pb-5"
        style={{ background: "var(--bg-deep)", border: "1px solid var(--border-accent)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center">
          <h2 className="font-display text-base text-[var(--purple-main)]">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="-m-3 ml-auto p-3 text-[var(--text-muted)] hover:text-[var(--text-body)]">
            <IconX size={16} />
          </button>
        </div>
        {children}
      </motion.div>
    </Overlay>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block font-label text-xs text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}
