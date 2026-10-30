import { useState } from "react";
import { IconBolt, IconMoodSmile } from "@tabler/icons-react";
import type { Checkin } from "../../types";

function Slider({ label, icon, value, onChange }: {
  label: string; icon: React.ReactNode; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-[var(--text-body)]">
        {icon} {label} <span className="ml-auto tabular text-[var(--purple-main)]">{value}/5</span>
      </div>
      <input
        type="range" min={1} max={5} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full"
      />
    </div>
  );
}

export function EnergyCheckin({ existing, onSave }: {
  existing: Checkin | null;
  onSave: (energy: number, mood: number) => void;
}) {
  const [energy, setEnergy] = useState(existing?.energy ?? 3);
  const [mood, setMood] = useState(existing?.mood ?? 3);

  if (existing) {
    return (
      <div className="flex items-center gap-4 text-xs text-[var(--text-body)]">
        <span className="flex items-center gap-1.5"><IconBolt size={14} className="text-[var(--purple-main)]" /> Energía <b className="tabular text-[var(--text-primary)]">{existing.energy}/5</b></span>
        <span className="flex items-center gap-1.5"><IconMoodSmile size={14} className="text-[var(--purple-main)]" /> Ánimo <b className="tabular text-[var(--text-primary)]">{existing.mood}/5</b></span>
        <span className="ml-auto text-xs italic text-[var(--text-muted)]">Registrado hoy</span>
      </div>
    );
  }

  return (
    <div>
      <Slider label="Energía" icon={<IconBolt size={13} />} value={energy} onChange={setEnergy} />
      <Slider label="Ánimo" icon={<IconMoodSmile size={13} />} value={mood} onChange={setMood} />
      <button className="btn btn-primary mt-1 w-full justify-center" onClick={() => onSave(energy, mood)}>
        Confirmar check-in
      </button>
    </div>
  );
}
