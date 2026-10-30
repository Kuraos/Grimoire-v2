import { useState } from "react";
import { IconChecklist, IconEdit } from "@tabler/icons-react";
import { LayoutGroup, motion } from "motion/react";
import type { Task } from "../../types";
import { Sigil, SigilName } from "./Sigil";
import { parseTags } from "./TagInput";

/* El sigilo de cada columna cuenta el mismo estado que el rótulo, en geometría:
   la caja vacía es lo que no se ha tocado, la caja partida lo que está a medio,
   la caja con marca lo despachado. Se lee antes que el texto. */
const COLUMNS: { key: Task["status"]; label: string; sigil: SigilName }[] = [
  { key: "todo", label: "Por hacer", sigil: "caja" },
  { key: "doing", label: "En curso", sigil: "cajaMedia" },
  { key: "done", label: "Hecho", sigil: "cajaMarcada" },
];

// Prioridad es dato semántico, no acento. Mismo criterio que TaskCard.
const PRIORITY_COLOR: Record<string, string> = { high: "var(--gr-oxblood)", medium: "var(--gr-amber)", low: "var(--gr-ink-dim)" };

const byPosition = (a: Task, b: Task) => a.position - b.position || a.id - b.id;

const COL_KEYS = COLUMNS.map((c) => c.key);
/** Any unexpected status falls back to "todo" so a task can never become
 *  invisible (unreachable) on the board. */
const statusOf = (t: Task): Task["status"] =>
  (COL_KEYS as string[]).includes(t.status) ? t.status : "todo";

export function KanbanBoard({ tasks, projectColor, onReorder, onEdit }: {
  tasks: Task[];
  projectColor: (id: number | null) => string | undefined;
  /** dragged task → target column + the full ordered id list for that column */
  onReorder: (task: Task, status: Task["status"], orderedIds: number[]) => void;
  onEdit: (task: Task) => void;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [overCard, setOverCard] = useState<number | null>(null);

  const drop = (status: Task["status"]) => {
    const dragged = tasks.find((x) => x.id === dragId);
    setOverCol(null);
    setOverCard(null);
    setDragId(null);
    if (!dragged) return;
    const column = tasks.filter((t) => statusOf(t) === status && t.id !== dragged.id).sort(byPosition);
    const idx = overCard != null ? column.findIndex((t) => t.id === overCard) : -1;
    const ordered = [...column];
    ordered.splice(idx >= 0 ? idx : ordered.length, 0, dragged);
    onReorder(dragged, status, ordered.map((t) => t.id));
  };

  return (
    <LayoutGroup>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => statusOf(t) === col.key).sort(byPosition);
        return (
          <div
            key={col.key}
            data-col={col.key}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); setOverCard(null); }}
            onDrop={() => drop(col.key)}
            className="rounded-lg border p-2 transition-colors"
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
              {items.map((t) => (
                /* La tarjeta que cambia de sitio viaja hasta él —también de una
                   columna a otra, por eso `layoutId` y no `layout`—. Va en un
                   envoltorio porque `motion.div` reinterpreta `onDragStart` como
                   su propio gesto, y aquí el arrastre es el nativo de HTML. */
                <motion.div key={t.id} layoutId={`tarea-${t.id}`} layout="position" transition={{ type: "spring", stiffness: 500, damping: 40 }}>
                <div
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null); setOverCard(null); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOverCol(col.key); setOverCard(t.id); }}
                  className="cursor-grab rounded-md border bg-[var(--bg-elevated)] p-2 active:cursor-grabbing"
                  style={{
                    borderColor: overCard === t.id ? "var(--border-glow)" : "var(--border)",
                    borderLeft: `2px solid ${projectColor(t.project_id) ?? "var(--border-accent)"}`,
                    opacity: dragId === t.id ? 0.4 : 1,
                  }}
                >
                  <div className="flex items-start gap-1.5">
                    <span className="mt-1 text-xs" style={{ color: PRIORITY_COLOR[t.priority] }}>●</span>
                    <span className={`flex-1 text-sm ${t.status === "done" ? "text-[var(--text-faint)] line-through" : "text-[var(--text-body)]"}`}>{t.title}</span>
                    <button onClick={() => onEdit(t)} className="text-[var(--text-faint)] hover:text-[var(--purple-main)]"><IconEdit size={12} /></button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-4 text-xs text-[var(--text-muted)]">
                    {t.checklist_total > 0 && (
                      <span className="flex items-center gap-0.5"><IconChecklist size={11} /> {t.checklist_done}/{t.checklist_total}</span>
                    )}
                    {parseTags(t.tags).map((tag) => (
                      <span key={tag} className="rounded-full bg-[var(--bg-elevated)] px-1.5 text-xs text-[var(--text-muted)]">{tag}</span>
                    ))}
                    {t.due_date && <span className="ml-auto">{t.due_date.slice(5)}</span>}
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
