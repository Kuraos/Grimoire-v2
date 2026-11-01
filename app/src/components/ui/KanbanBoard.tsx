import { useState } from "react";
import { IconArrowsMove, IconChecklist, IconClock, IconEdit } from "@tabler/icons-react";
import { LayoutGroup, motion } from "motion/react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { ApiTask } from "../../types";
import { Segmented } from "./Segmented";
import { Sigil, SigilName } from "./Sigil";
import { parseTags } from "./TagInput";

/* El sigilo de cada columna cuenta el mismo estado que el rótulo, en geometría:
   la caja vacía es lo que no se ha tocado, la caja partida lo que está a medio,
   la caja con marca lo despachado. Se lee antes que el texto. */
export const COLUMNS: { key: ApiTask["status"]; label: string; sigil: SigilName }[] = [
  { key: "todo", label: "Por hacer", sigil: "caja" },
  { key: "doing", label: "En curso", sigil: "cajaMedia" },
  { key: "done", label: "Hecho", sigil: "cajaMarcada" },
];

// Prioridad es dato semántico, no acento. Mismo criterio que TaskCard.
const PRIORITY_COLOR: Record<string, string> = { high: "var(--gr-oxblood)", medium: "var(--gr-amber)", low: "var(--gr-ink-dim)" };

/**
 * `tasks` llega en el orden del tablero (`rank`, `id`). El arrastre es el nativo de HTML, que no
 * funciona con el dedo: en táctil se apaga, para no pelear con el scroll, y mover se hace con el
 * botón visible de cada tarjeta (decisión 9).
 */
export function KanbanBoard({ tasks, pendingIds, projectColor, onReorder, onEdit, onMove }: {
  tasks: ApiTask[];
  pendingIds?: Set<string>;
  projectColor: (id: string | null) => string | undefined;
  /** Tarea soltada → columna de destino + las claves vecinas donde cayó. */
  onReorder: (task: ApiTask, status: ApiTask["status"], prev: string | null, next: string | null) => void;
  onEdit: (task: ApiTask) => void;
  onMove: (task: ApiTask) => void;
}) {
  const coarse = useMediaQuery("(pointer: coarse)");
  const [shown, setShown] = useState<ApiTask["status"]>("todo");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [overCard, setOverCard] = useState<string | null>(null);

  const drop = (status: ApiTask["status"]) => {
    const dragged = tasks.find((x) => x.id === dragId);
    const target = overCard;
    setOverCol(null);
    setOverCard(null);
    setDragId(null);
    if (!dragged || target === dragged.id) return;
    const column = tasks.filter((t) => t.status === status && t.id !== dragged.id);
    const found = target !== null ? column.findIndex((t) => t.id === target) : -1;
    const at = found >= 0 ? found : column.length;
    onReorder(dragged, status, column[at - 1]?.rank ?? null, column[at]?.rank ?? null);
  };

  return (
    <LayoutGroup>
    {/* En teléfono, una columna a la vez. */}
    <div className="mb-3 md:hidden">
      <Segmented label="Columna" size="sm" value={shown} onChange={setShown} options={COLUMNS.map((c) => ({
        value: c.key,
        // el conteo debajo: con dos cifras en cada columna, en una línea no caben las tres
        label: <span className="flex flex-col items-center whitespace-nowrap">{c.label} <span className="tabular">{tasks.filter((t) => t.status === c.key).length}</span></span>,
      }))} />
    </div>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.key);
        return (
          <div
            key={col.key}
            data-col={col.key}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); setOverCard(null); }}
            onDrop={() => drop(col.key)}
            className={`min-w-0 rounded-lg border p-2 transition-colors ${shown === col.key ? "" : "hidden md:block"}`}
            style={{
              background: "var(--bg-surface)",
              borderColor: overCol === col.key ? "var(--border-glow)" : "var(--border)",
              minHeight: 120,
            }}
          >
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="text-[var(--text-muted)]"><Sigil name={col.sigil} size={18} /></span>
              <span className="font-label text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">{col.label}</span>
              <span className="tabular text-xs text-[var(--text-faint)]">{items.length}</span>
              <span className="gr-filete" />
              <span className="gr-rombo" />
            </div>
            <div className="space-y-2">
              {items.length === 0 && <p className="px-1 text-xs text-[var(--text-muted)]">Sin tareas.</p>}
              {items.map((t) => (
                /* La tarjeta que cambia de sitio viaja hasta él —también de una
                   columna a otra, por eso `layoutId` y no `layout`—. Va en un
                   envoltorio porque `motion.div` reinterpreta `onDragStart` como
                   su propio gesto, y aquí el arrastre es el nativo de HTML. */
                <motion.div key={t.id} layoutId={`tarea-${t.id}`} layout="position" transition={{ type: "spring", stiffness: 500, damping: 40 }}>
                <div
                  draggable={!coarse}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null); setOverCard(null); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOverCol(col.key); setOverCard(t.id); }}
                  className={`rounded-md border bg-[var(--bg-elevated)] p-2 ${coarse ? "" : "cursor-grab active:cursor-grabbing"}`}
                  style={{
                    borderColor: overCard === t.id ? "var(--border-glow)" : "var(--border)",
                    borderLeftWidth: 2,
                    borderLeftColor: projectColor(t.project_id) ?? "var(--border-accent)",
                    opacity: dragId === t.id ? 0.4 : 1,
                  }}
                >
                  <div className="flex items-start gap-1.5">
                    <span className="mt-1 text-xs" style={{ color: PRIORITY_COLOR[t.priority] }}>●</span>
                    <span className={`min-w-0 flex-1 break-words text-sm ${t.status === "done" ? "text-[var(--text-faint)] line-through" : "text-[var(--text-body)]"}`}>{t.title}</span>
                    <span className="flex shrink-0 items-center gap-5 pl-3 pr-1 lg:gap-2 lg:pl-0 lg:pr-0">
                      <button onClick={() => onMove(t)} aria-label={`Mover ${t.title}`} title="Mover" className="gr-tactil text-[var(--text-faint)] hover:text-[var(--purple-main)]"><IconArrowsMove size={14} /></button>
                      <button onClick={() => onEdit(t)} aria-label={`Editar ${t.title}`} title="Editar" className="gr-tactil text-[var(--text-faint)] hover:text-[var(--purple-main)]"><IconEdit size={14} /></button>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-4 text-xs text-[var(--text-muted)]">
                    {t.checklist_total > 0 && (
                      <span className="flex items-center gap-0.5 tabular"><IconChecklist size={11} /> {t.checklist_done}/{t.checklist_total}</span>
                    )}
                    {parseTags(t.tags).map((tag) => (
                      <span key={tag} className="rounded-full bg-[var(--bg-elevated)] px-1.5 text-xs text-[var(--text-muted)]">{tag}</span>
                    ))}
                    {pendingIds?.has(t.id) && <span className="inline-flex items-center gap-0.5"><IconClock size={11} /> pendiente</span>}
                    {t.due_date && <span className="ml-auto tabular">{t.due_date.slice(5)}</span>}
                  </div>
                </div>
                </motion.div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
    </LayoutGroup>
  );
}
