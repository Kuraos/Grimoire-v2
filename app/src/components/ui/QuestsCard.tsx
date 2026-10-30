import { IconTargetArrow } from "@tabler/icons-react";
import { TablerIcon } from "../TablerIcon";
import { Card } from "./Card";
import { SectionBand } from "./SectionBand";
import { QuestRings } from "./QuestRings";
import type { SigilName } from "./Sigil";
import type { Quest } from "../../types";

// TODO(fase-N): misiones y reclamarlas contra la API nueva (antes Api.listQuests /
// Api.claimQuest + handleXP); quien use la card las pasa por props.
export function QuestsCard({ quests, claim }: { quests: Quest[]; claim: (q: Quest) => void }) {

  const daily = quests.filter((q) => q.scope === "daily");
  const weekly = quests.filter((q) => q.scope === "weekly");

  return (
    <Card title="Misiones" icon={<IconTargetArrow size={14} />}>
      {/* Diarias y semanales cuelgan cada una de su sigilo y su espina, igual
          que las categorías de hábitos: son dos plazos distintos, no una lista
          con un subtítulo en medio. El reloj es el día; el libro, la semana. */}
      <Group sigil="reloj" label="Diarias" quests={daily} onClaim={claim} rings />
      <div className="mt-3">
        <Group sigil="libro" label="Semanales" quests={weekly} onClaim={claim} />
      </div>
      {/* Filete de cierre: la card termina en algo en vez de cortarse contra
          el borde inferior. */}
      <div className="mt-3 flex items-center gap-2.5">
        <span className="gr-filete" />
        <span className="gr-rombo" />
      </div>
    </Card>
  );
}

function Group({ sigil, label, quests, onClaim, rings }: {
  sigil: SigilName; label: string; quests: Quest[]; onClaim: (q: Quest) => void;
  /** Las diarias van en anillos: son las metas del día, y caben de un vistazo. */
  rings?: boolean;
}) {
  return (
    <SectionBand sigil={sigil} label={label} count={quests.filter((q) => q.claimed).length || undefined}
                 fill="linea" spine>
      {rings ? <QuestRings quests={quests} onClaim={onClaim} /> : (
      <div className="space-y-2">
        {quests.map((q) => {
          const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
          const claimable = q.completed && !q.claimed;
          return (
            <div key={q.id} className="text-sm">
              <div className="flex items-center gap-2">
                <TablerIcon name={q.icon} size={14} className={q.claimed ? "text-[var(--success)]" : "text-[var(--text-muted)]"} />
                <span className={`flex-1 ${q.claimed ? "text-[var(--text-faint)] line-through" : "text-[var(--text-body)]"}`}>{q.title}</span>
                <span className="tabular text-xs text-[var(--text-muted)]">{q.progress}/{q.target}</span>
                {claimable ? (
                  /* Misión cumplida y sin reclamar: es lo único dorado de la card. */
                  <button onClick={() => onClaim(q)} className="gr-reward rounded border border-[var(--gr-gilded)] bg-[var(--gr-gilded-deep)] px-1.5 py-0.5 font-label text-xs text-[var(--gr-gilded-bright)] hover:border-[var(--gr-gilded-bright)]">
                    +{q.xp_reward}
                  </button>
                ) : (
                  <span className="font-label text-xs text-[var(--text-faint)]">{q.claimed ? "✓" : `+${q.xp_reward}`}</span>
                )}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: q.claimed ? "var(--success)" : "linear-gradient(90deg,var(--gr-xp-from),var(--gr-arcane))" }} />
              </div>
            </div>
          );
        })}
      </div>
      )}
    </SectionBand>
  );
}
