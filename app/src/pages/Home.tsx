import { useNavigate } from "react-router-dom";
import { IconChartBar, IconClock, IconListCheck, IconRepeat } from "@tabler/icons-react";
import { useHome } from "../api/home";
import { habitActions } from "../api/habits";
import { taskActions } from "../api/tasks";
import { usePomodoroCtx } from "../pomodoro-context";
import { PageHeader } from "../components/layout/PageHeader";
import { XPBar } from "../components/ui/XPBar";
import { Card } from "../components/ui/Card";
import { SectionBand } from "../components/ui/SectionBand";
import { HabitRow } from "../components/ui/HabitRow";
import { TaskCard } from "../components/ui/TaskCard";
import { sigilDeCategoria } from "../components/ui/Sigil";
import { DaySigil } from "../components/charts/DaySigil";
import { ClockedTimer } from "./Pomodoro";
import type { Habit } from "../types";

/*
 * El Inicio de la v1 (`Dashboard.tsx`) sin Misiones, Energía/Ánimo ni el minicalendario (filas 45 a
 * 47). Los datos vienen de `useHome` (2.5.3): hábitos, tareas y minutos de foco con la cola encima;
 * el XP, del servidor. En el teléfono, una columna con la `rubric` primero; en `lg:`, las columnas
 * de la v1.
 */
export default function Home() {
  const h = useHome();
  const pomo = usePomodoroCtx();
  const nav = useNavigate();

  const undo = (habit: Habit) => {
    if (habit.last_mark) habitActions.undo(habit, habit.last_mark.id);
  };
  const xpToday = h.xpToday ?? 0;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Hoy"
        context={
          h.habitsOffline
            ? "Sin conexión"
            : h.habitsTotal > 0
            ? `${h.habitsDone} de ${h.habitsTotal} hábitos · ${xpToday} XP · ${h.focusMinutes} min de foco`
            : "Sin hábitos todavía"
        }
      />

      {/* Sin usuario y sin conexión, la barra diría «Cargando…» para siempre: no se muestra. */}
      {(h.user || !h.habitsOffline) && (
        <XPBar user={h.user} xpToday={h.xpToday ?? undefined} streakBonus={h.streakBonus} />
      )}

      {/* Columnas flex, no una rejilla, como en la v1: cada tarjeta mide lo que su contenido. Sin
          Misiones ni Energía, la columna del medio de la v1 quedaba solo con el Pomodoro: en `lg:` son
          dos columnas, y en el teléfono el orden es el mismo. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-[1.4]">
          <Card
            rank="rubric"
            title="Hábitos de hoy"
            icon={<IconRepeat size={14} />}
            right={!h.habitsOffline && (
              <span className="gr-figure">
                <span className="text-[var(--gr-gilded)]">{h.habitsDone}</span>
                <span className="text-[var(--text-faint)]">/{h.habitsTotal}</span>
              </span>
            )}
          >
            {h.habitsOffline ? (
              <p className="text-sm text-[var(--text-muted)]">Sin conexión. Los hábitos se cargan cuando vuelva la señal.</p>
            ) : h.habitsTotal === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Sin hábitos. Créalos en la sección Hábitos.</p>
            ) : null}
            {h.groups.map((g) => (
              <div key={g.category} className="pt-2 first:pt-0">
                <SectionBand
                  sigil={sigilDeCategoria(g.category)}
                  label={g.category}
                  count={`${g.items.filter((x) => x.done_today).length}/${g.items.length}`}
                  fill="linea"
                  spine
                >
                  {g.items.map((habit) => (
                    <HabitRow key={habit.id} habit={habit} onComplete={habitActions.complete} onUndo={undo}
                      onClick={() => nav("/habitos")} />
                  ))}
                </SectionBand>
              </div>
            ))}
          </Card>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {pomo && (
            <Card title="Pomodoro" icon={<IconClock size={14} />}>
              <ClockedTimer
                phase={pomo.phase}
                running={pomo.running}
                subtitle={pomo.activeTask?.title}
                big={false}
                onStart={pomo.start}
                onPause={pomo.pause}
                side={
                  <button className="btn justify-center" onClick={() => nav("/pomodoro")}>
                    {pomo.running ? "Ver sesión" : "Configurar"}
                  </button>
                }
              />
            </Card>
          )}

          <Card title="Tareas prioritarias" icon={<IconListCheck size={14} />}>
            {h.tasksOffline ? (
              <p className="text-sm text-[var(--text-muted)]">Sin conexión. Las tareas se cargan cuando vuelva la señal.</p>
            ) : h.priorityTasks.length === 0 && <p className="text-sm text-[var(--text-muted)]">Nada pendiente. ✦</p>}
            {h.priorityTasks.map((t) => (
              <TaskCard key={t.id} task={t} pending={h.pendingTaskIds.has(t.id)} onComplete={taskActions.complete} />
            ))}
            {/* Dos filetes de cierre, el segundo más tenue: la lista se apaga en vez de cortarse. */}
            <div className="mt-2 flex items-center gap-2.5">
              <span className="gr-filete" />
              <span className="gr-rombo" />
            </div>
            <div className="mt-2 flex items-center gap-2.5">
              <span className="gr-filete" />
              <span className="gr-rombo opacity-40" />
            </div>
          </Card>

          <DaySigil habits={h.habits} />
        </div>
      </div>

      {/* Sin datos, tres ceros parecerían un día vacío. */}
      {!h.habitsOffline && (
        <Card rank="marginalia" title="Resumen del día" icon={<IconChartBar size={14} />}>
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            <Stat value={`${xpToday}`} label="XP hoy" gold />
            <Stat value={`${h.habitsDone}/${h.habitsTotal}`} label="Hábitos" />
            <Stat value={`${h.focusMinutes}m`} label="Foco" />
          </div>
        </Card>
      )}
    </div>
  );
}

/* Sin caja: en marginalia la cifra y su rótulo se sostienen solos. */
function Stat({ value, label, gold }: { value: string; label: string; gold?: boolean }) {
  return (
    <div>
      <div className="text-xl tabular leading-none" style={{ color: gold ? "var(--gr-gilded)" : "var(--text-primary)" }}>
        {value}
      </div>
      <div className="mt-1.5 text-2xs font-label text-[var(--text-muted)]">{label}</div>
    </div>
  );
}
