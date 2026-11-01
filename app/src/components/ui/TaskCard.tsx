import { IconSquare, IconSquareCheck, IconCalendarDue, IconTrash, IconEdit, IconChecklist, IconClock } from "@tabler/icons-react";
import { todayISO } from "../../utils";
import type { ApiTask } from "../../types";
import { parseTags } from "./TagInput";

const PRIORITY: Record<string, { label: string; color: string }> = {
  high: { label: "Alta", color: "var(--danger)" },
  medium: { label: "Media", color: "var(--warning)" },
  low: { label: "Baja", color: "var(--purple-muted)" },
};

/**
 * En teléfono, tocar el texto abre el formulario, que también borra: tres iconos de 44 px le
 * quitaban el ancho al título. En `lg:`, las acciones de la v1 en la fila.
 */
export function TaskCard({ task, projectColor, pending, onComplete, onUncomplete, onDelete, onEdit }: {
  task: ApiTask;
  projectColor?: string;
  /** Hay cambios que aún no llegan al servidor. */
  pending?: boolean;
  onComplete: (t: ApiTask) => void;
  onUncomplete?: (t: ApiTask) => void;
  onDelete?: (t: ApiTask) => void;
  onEdit?: (t: ApiTask) => void;
}) {
  const pr = PRIORITY[task.priority] ?? PRIORITY.medium;
  const overdue = task.due_date && !task.completed && task.due_date < todayISO();
  const toggle = () => (task.completed ? onUncomplete?.(task) : onComplete(task));

  return (
    <div className="card flex items-center gap-3" style={projectColor ? { borderLeft: `2px solid ${projectColor}` } : undefined}>
      <button onClick={toggle} title={task.completed ? "Reabrir" : "Completar"} aria-label={`${task.completed ? "Reabrir" : "Completar"} ${task.title}`} className="gr-tactil shrink-0 text-[var(--text-muted)] hover:text-[var(--purple-main)]">
        {task.completed ? <IconSquareCheck size={18} className="text-[var(--success)]" /> : <IconSquare size={18} />}
      </button>
      <div className={`min-w-0 flex-1 ${onEdit ? "cursor-pointer lg:cursor-auto" : ""}`} onClick={() => onEdit?.(task)}>
        <div className={`truncate text-sm ${task.completed ? "text-[var(--text-faint)] line-through" : "text-[var(--text-primary)]"}`}>
          {task.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-muted)]">
          <span style={{ color: pr.color }}>● {pr.label}</span>
          {task.category && <span>· {task.category}</span>}
          {task.due_date && (
            <span className={`tabular ${overdue ? "text-[var(--gr-oxblood)]" : ""}`}>
              <IconCalendarDue size={11} className="inline" /> {task.due_date}
            </span>
          )}
          {task.checklist_total > 0 && (
            <span className="flex items-center gap-0.5 tabular"><IconChecklist size={11} /> {task.checklist_done}/{task.checklist_total}</span>
          )}
          <span className="tabular">· {task.xp_reward} XP</span>
          {parseTags(task.tags).map((tag) => (
            <span key={tag} className="rounded-full bg-[var(--bg-elevated)] px-1.5 text-xs text-[var(--text-muted)]">{tag}</span>
          ))}
          {pending && <span className="inline-flex items-center gap-0.5"><IconClock size={11} /> pendiente</span>}
        </div>
      </div>
      {onEdit && (
        <button onClick={() => onEdit(task)} title="Editar" aria-label={`Editar ${task.title}`} className="hidden text-[var(--text-faint)] hover:text-[var(--purple-main)] lg:block">
          <IconEdit size={14} />
        </button>
      )}
      {onDelete && (
        <button onClick={() => onDelete(task)} title="Eliminar" aria-label={`Eliminar ${task.title}`} className="hidden text-[var(--text-faint)] hover:text-[var(--gr-oxblood)] lg:block">
          <IconTrash size={14} />
        </button>
      )}
    </div>
  );
}
