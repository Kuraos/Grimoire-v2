import { IconSquare, IconSquareCheck, IconCalendarDue, IconTrash, IconEdit, IconChecklist, IconPlayerPlay } from "@tabler/icons-react";
import type { Task } from "../../types";
import { parseTags } from "./TagInput";

const PRIORITY: Record<string, { label: string; color: string }> = {
  high: { label: "Alta", color: "var(--danger)" },
  medium: { label: "Media", color: "var(--warning)" },
  low: { label: "Baja", color: "var(--purple-muted)" },
};

export function TaskCard({ task, projectColor, onComplete, onUncomplete, onDelete, onEdit, onFocus, compact }: {
  task: Task;
  projectColor?: string;
  onComplete: (t: Task) => void;
  onUncomplete?: (t: Task) => void;
  onDelete?: (t: Task) => void;
  onEdit?: (t: Task) => void;
  /** Arranca un pomodoro sobre esta tarea. */
  onFocus?: (t: Task) => void;
  compact?: boolean;
}) {
  const pr = PRIORITY[task.priority] ?? PRIORITY.medium;
  const overdue = task.due_date && !task.completed && new Date(task.due_date) < new Date(new Date().toDateString());
  const toggle = () => (task.completed ? onUncomplete?.(task) : onComplete(task));

  if (compact) {
    return (
      <div className={`flex items-center gap-2 border-b border-[var(--gr-edge)] py-1 text-sm last:border-none ${
        task.completed ? "text-[var(--text-faint)] line-through" : "text-[var(--text-body)]"
      }`}>
        <button onClick={toggle} className="text-[var(--text-muted)] hover:text-[var(--purple-main)]">
          {task.completed ? <IconSquareCheck size={14} /> : <IconSquare size={14} />}
        </button>
        <span className="truncate">{task.title}</span>
        {task.due_date && (
          <span className={`ml-auto text-xs ${overdue ? "text-[var(--gr-oxblood)]" : "text-[var(--text-muted)]"}`}>
            {task.due_date.slice(5)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="card flex items-center gap-3" style={projectColor ? { borderLeft: `2px solid ${projectColor}` } : undefined}>
      <button onClick={toggle} title={task.completed ? "Reabrir" : "Completar"} className="text-[var(--text-muted)] hover:text-[var(--purple-main)]">
        {task.completed ? <IconSquareCheck size={18} className="text-[var(--success)]" /> : <IconSquare size={18} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${task.completed ? "text-[var(--text-faint)] line-through" : "text-[var(--text-primary)]"}`}>
          {task.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span style={{ color: pr.color }}>● {pr.label}</span>
          {task.category && <span>· {task.category}</span>}
          {task.due_date && (
            <span className={overdue ? "text-[var(--gr-oxblood)]" : ""}>
              <IconCalendarDue size={11} className="inline" /> {task.due_date}
            </span>
          )}
          {task.checklist_total > 0 && (
            <span className="flex items-center gap-0.5"><IconChecklist size={11} /> {task.checklist_done}/{task.checklist_total}</span>
          )}
          <span>· {task.xp_reward} XP</span>
          {parseTags(task.tags).map((tag) => (
            <span key={tag} className="rounded-full bg-[var(--bg-elevated)] px-1.5 text-xs text-[var(--text-muted)]">{tag}</span>
          ))}
        </div>
      </div>
      {/* Enfocar es la acción del día sobre una tarea, y llegar a ella obligaba a
          ir a Pomodoro y buscarla en un desplegable de todas las pendientes. */}
      {onFocus && !task.completed && (
        <button onClick={() => onFocus(task)} title="Iniciar un pomodoro con esta tarea" className="text-[var(--text-faint)] hover:text-[var(--purple-main)]">
          <IconPlayerPlay size={14} />
        </button>
      )}
      {onEdit && (
        <button onClick={() => onEdit(task)} title="Editar" className="text-[var(--text-faint)] hover:text-[var(--purple-main)]">
          <IconEdit size={14} />
        </button>
      )}
      {onDelete && (
        <button onClick={() => onDelete(task)} title="Eliminar" className="text-[var(--text-faint)] hover:text-[var(--gr-oxblood)]">
          <IconTrash size={14} />
        </button>
      )}
    </div>
  );
}
