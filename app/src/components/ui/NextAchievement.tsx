import { Card } from "./Card";
import { TablerIcon } from "../TablerIcon";
import { TIER_META } from "../../utils";
import { tracery } from "../../polar";
import type { Achievement } from "../../types";

/**
 * El más cercano: el logro que está a menos distancia de caer.
 *
 * La rejilla dice qué hay; esto dice qué sigue. Sin él, la vista de Logros era
 * un museo —todo pasado— y la pregunta que se hace alguien al abrirla es cuál
 * puede cerrar esta semana.
 *
 * Es la única pieza figurativa del sistema y la única tracería que existe: un
 * medallón de doce puntas alrededor del progreso. Se permite aquí y en ningún
 * otro sitio porque un logro es lo único puramente ceremonial que tiene la app
 * — no informa de nada que no diga la barra, y ese es justo su trabajo.
 */

const CX = 120;

export function NextAchievement({ items }: { items: Achievement[] }) {
  // El más cercano por progreso, entre los que aún no han caído. Los de
  // progreso cero no cuentan: «más cercano» tiene que significar empezado.
  const next = items
    .filter((a) => !a.unlocked && a.progress > 0)
    .sort((a, b) => b.progress - a.progress)[0];

  if (!next) return null;

  const tier = TIER_META[next.tier] ?? TIER_META.common;
  const pct = Math.round(next.progress * 100);
  const R = 60;
  const C = 2 * Math.PI * R;

  return (
    <Card rank="rubric">
      <div className="gr-sangrado mb-4">
        <span className="gr-rubrica">El más cercano</span>
      </div>

      <div className="flex flex-col items-center text-center">
        <svg width="240" height="240" viewBox="0 0 240 240" fill="none" role="img"
             aria-label={`${next.name}: ${pct}% completado`}>
          <path d={tracery(CX, 72, 96, 12)} stroke="var(--gr-gilded)" strokeOpacity="0.42"
                strokeWidth="1.1" strokeLinejoin="round" />
          <circle cx={CX} cy={CX} r="72" stroke="var(--border-strong)" strokeWidth="1" />
          <circle cx={CX} cy={CX} r={R} stroke="var(--gr-gilded)" strokeOpacity="0.35"
                  strokeWidth="1" strokeDasharray="3 6" />
          {/* El arco de progreso en oro, aunque todavía no esté ganado: es la
              excepción que el mock fija, y se sostiene porque aquí el oro no
              marca «conseguido» sino «esto es lo que vas a ganar». */}
          <circle cx={CX} cy={CX} r={R} stroke="var(--gr-gilded)" strokeWidth="4"
                  strokeLinecap="round" strokeDasharray={`${(pct / 100) * C} ${C}`}
                  transform={`rotate(-90 ${CX} ${CX})`} />
          <text x={CX} y={CX - 6} textAnchor="middle" fontFamily="Cinzel, Georgia, serif"
                fontSize="30" fontWeight="600" fill="var(--gr-gilded-bright)">
            {pct}%
          </text>
          <text x={CX} y={CX + 20} textAnchor="middle" fontFamily="Inter, sans-serif"
                fontSize="11" fontWeight="600" letterSpacing="1.5" fill="var(--gr-ink-faint)">
            COMPLETADO
          </text>
        </svg>

        <div className="mt-2 flex items-center gap-2">
          <span style={{ color: tier.color }}><TablerIcon name={next.icon} size={18} /></span>
          <span className="gr-emphasis">{next.name}</span>
        </div>
        <div className="mt-1 font-label text-2xs tracking-[0.24em]" style={{ color: tier.color }}>
          {tier.label}
        </div>
        <p className="mt-2.5 max-w-xs font-prose text-sm text-[var(--text-body)] [text-wrap:pretty]">
          {next.description}
        </p>
      </div>
    </Card>
  );
}
