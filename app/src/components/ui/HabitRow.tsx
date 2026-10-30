import { IconFlame } from "@tabler/icons-react";
import type { Habit } from "../../types";
import { CATEGORY_COLORS, streakUnit } from "../../utils";

export function HabitRow({ habit, onComplete, onUndo, onClick }: {
  habit: Habit;
  onComplete: (h: Habit) => void;
  onUndo?: (h: Habit) => void;
  onClick?: (h: Habit) => void;
}) {
  const color = habit.color || CATEGORY_COLORS[habit.category] || "var(--gr-arcane)";
  return (
    <div className="flex items-center gap-2 border-b border-[var(--gr-edge)] py-1.5 text-sm text-[var(--text-body)] last:border-none">
      <button
        onClick={() => (habit.done_today ? onUndo?.(habit) : onComplete(habit))}
        title={habit.done_today ? "Deshacer" : "Marcar como completado"}
        className={`group flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
          habit.done_today
            ? "border-[var(--gr-gilded)] bg-[var(--gr-gilded-deep)]"
            : "border-[var(--border-accent)] hover:border-[var(--border-glow)]"
        }`}
      >
        {/* El sello de completado es oro —es lo que el día se ha ganado— y el
            trazo se dibuja en vez de aparecer de golpe. */}
        {habit.done_today && (
          <svg className="gr-seal" width="10" height="10" viewBox="0 0 24 24" fill="none"
               stroke="var(--gr-gilded-bright)" strokeWidth="4"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12.5l5.5 5.5L20 6.5" />
          </svg>
        )}
      </button>
      <span
        className="h-2.5 w-1 shrink-0 rounded"
        style={{ background: color }}
        title={habit.category}
      />
      <span
        className={`cursor-pointer truncate hover:text-[var(--text-primary)] ${habit.done_today ? "text-[var(--text-muted)]" : ""}`}
        onClick={() => onClick?.(habit)}
      >
        {habit.name}
      </span>
      {/* La racha sólo aparece si existe. En oro, que es el acento de lo que se
          ha ganado, un «0» repetido en cada fila decía «recompensa» donde no hay
          ninguna — y con nueve hábitos sin racha, la columna entera era oro sin
          motivo. `HabitCardGothic` ya lo hacía así; ésta se quedó atrás. */}
      {habit.streak > 0 && (
        <span
          className="ml-auto flex items-center gap-1 text-xs tabular text-[var(--gr-gilded)]"
          title={`Racha de ${habit.streak} ${streakUnit(habit, habit.streak)}`}
        >
          <IconFlame size={12} /> {habit.streak}
        </span>
      )}
    </div>
  );
}
