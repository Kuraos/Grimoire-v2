import { useState } from "react";
import { IconFlame } from "@tabler/icons-react";
import { Card } from "./components/ui/Card";
import { XPBar } from "./components/ui/XPBar";
import { HabitCardGothic } from "./components/ui/HabitCardGothic";
import { HoldButton } from "./components/ui/HoldButton";
import { BudgetRail } from "./components/ui/BudgetRail";
import { Sigil } from "./components/ui/Sigil";
import { Modal } from "./components/ui/Modal";
import { XPBarChart } from "./components/charts/XPBarChart";
import { chartPalette } from "./theme-tokens";
import type { Habit, User } from "./types";

/**
 * Página temporal de la fase 1.1 (/_muestrario): los componentes portados con
 * datos inventados, para capturar el punto de partida en teléfono y tablet.
 */
const user: User = {
  id: 1, name: "Aprendiz", xp: 1250, level: 3, title: "Adepto", lives: 2,
  obsidian_vault_path: null, xp_for_current_level: 900, xp_for_next_level: 1600,
  xp_into_level: 350, xp_span: 700,
};

const habit = (over: Partial<Habit>): Habit => ({
  id: 1, name: "Leer 20 páginas", category: "Académico", frequency: "daily", days: null,
  target_per_week: 1, xp_reward: 20, color: chartPalette().arcane, active: true, notes: null,
  tags: null, created_at: "2026-01-01T00:00:00Z", streak: 12, best_streak: 30, total_xp: 480,
  completion_rate: 82, done_today: false, last_completed: "2026-10-28", ...over,
});

const xpDays = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-10-${String(i + 16).padStart(2, "0")}`,
  xp: [40, 60, 20, 80, 55, 0, 35, 90, 70, 45, 65, 30, 75, 50][i],
}));

export default function Muestrario() {
  const [modal, setModal] = useState(false);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <XPBar user={user} xpToday={85} streakBonus={1.1} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card rank="rubric" title="Rango rubric" icon={<IconFlame size={14} />}>Contenido de ejemplo.</Card>
        <Card rank="leaf" title="Rango leaf">Contenido de ejemplo.</Card>
        <Card rank="marginalia" title="Rango marginalia">Contenido de ejemplo.</Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <HabitCardGothic habit={habit({})} onComplete={() => {}} />
        <HabitCardGothic habit={habit({ id: 2, name: "Correr 5 km", category: "Físico", done_today: true, streak: 4 })} />
      </div>
      <Card title="Carriles y sigilos">
        <div className="flex flex-col gap-3">
          <BudgetRail name="Comida" color={chartPalette().arcane} spent={420000} budget={600000} currency="COP" />
          <BudgetRail name="Transporte" color={chartPalette().arcane} spent={310000} budget={250000} currency="COP" />
          <div className="flex gap-3">
            {(["disco", "triangulo", "creciente", "rombo", "hexagono", "hexagonoAnidado"] as const).map((s) => (
              <Sigil key={s} name={s} />
            ))}
          </div>
        </div>
      </Card>
      <Card title="XP por día">
        <XPBarChart data={xpDays} />
      </Card>
      <div className="flex gap-3">
        <HoldButton completeLabel="Borrado" onComplete={() => {}}>Mantén para borrar</HoldButton>
        <button className="btn" onClick={() => setModal(true)}>Abrir modal</button>
      </div>
      {modal && <Modal title="Modal de ejemplo" onClose={() => setModal(false)}>Contenido del modal.</Modal>}
    </main>
  );
}
