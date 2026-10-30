import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { IconX } from "@tabler/icons-react";
import { useApp, type Toast } from "../../context";
import { TablerIcon } from "../TablerIcon";

/**
 * Los avisos como una pila. Adaptado del «notification stack» de Kokonut UI.
 *
 * Antes eran una columna que crecía hacia abajo con cada logro y se iban a los
 * cuatro segundos aunque se estuvieran leyendo. Ahora el más nuevo va delante
 * y los anteriores asoman detrás; al pasar por encima la pila se abre en
 * abanico y el reloj de todos se para —nadie pierde un aviso mientras lo lee—.
 * Arrastrar uno a la derecha lo descarta.
 */
const LIFETIME = 4000;
const H = 58;
const GAP = 8;
const PEEK = 9;
const BEHIND = 2;

export function ToastAchievement() {
  const { toasts, dismissToast } = useApp();
  const [hover, setHover] = useState(false);
  const list = [...toasts].reverse(); // el más nuevo, delante
  const expanded = hover && list.length > 1;
  const height = list.length === 0 ? 0 : expanded ? list.length * (H + GAP) - GAP : H + Math.min(list.length - 1, BEHIND) * PEEK;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] w-72">
      <motion.div
        className="pointer-events-auto relative"
        animate={{ height }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <AnimatePresence initial={false}>
          {list.map((t, depth) => (
            <ToastCard key={t.id} toast={t} depth={depth} expanded={expanded} paused={hover} onDismiss={() => dismissToast(t.id)} />
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function ToastCard({ toast: t, depth, expanded, paused, onDismiss }: {
  toast: Toast; depth: number; expanded: boolean; paused: boolean; onDismiss: () => void;
}) {
  const error = t.variant === "error";
  const left = useRef(LIFETIME);

  // Su propio reloj, que se para mientras la pila está bajo el puntero.
  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const timer = setTimeout(onDismiss, left.current);
    return () => { clearTimeout(timer); left.current -= Date.now() - start; };
  }, [paused, onDismiss]);

  const hidden = !expanded && depth > BEHIND;
  return (
    <motion.div
      layout="position"
      className="absolute inset-x-0 top-0 flex items-center gap-3 rounded-lg px-3"
      style={{
        height: H, zIndex: 100 - depth, transformOrigin: "top center",
        background: "var(--bg-deep)",
        border: `0.5px solid ${error ? "var(--gr-edge-danger)" : "var(--gr-gilded-deep)"}`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        pointerEvents: hidden ? "none" : "auto",
      }}
      initial={{ opacity: 0, x: 40, y: 0, scale: 1 }}
      animate={{
        opacity: hidden ? 0 : 1, x: 0,
        y: expanded ? depth * (H + GAP) : depth * PEEK,
        scale: expanded ? 1 : 1 - depth * 0.05,
      }}
      exit={{ opacity: 0, x: 120, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      drag={depth === 0 || expanded ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.05, right: 0.9 }}
      onDragEnd={(_, info: PanInfo) => {
        if (info.offset.x > 90 || info.velocity.x > 500) onDismiss();
      }}
    >
      {/* Un toast no-error siempre anuncia algo ganado: XP, logro, vida. */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
           style={{ background: error ? "var(--gr-oxblood-deep)" : "var(--gr-gilded-deep)", color: error ? "var(--gr-oxblood)" : "var(--gr-gilded-bright)" }}>
        <TablerIcon name={t.icon ?? "trophy"} size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-label text-xs text-[var(--text-muted)]">{t.title}</div>
        <div className="truncate text-sm text-[var(--text-primary)]">{t.body}</div>
      </div>
      <button onClick={onDismiss} className="text-[var(--text-faint)] hover:text-[var(--text-body)]" aria-label="Descartar">
        <IconX size={14} />
      </button>
    </motion.div>
  );
}
