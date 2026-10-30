import { useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import type { Achievement } from "../../types";
import { TablerIcon } from "../TablerIcon";
import { TIER_META } from "../../utils";
import { tracery } from "../../polar";
import { useReducedMotion } from "../../motion-pref";

/**
 * Ley del acento: un logro desbloqueado es recompensa, así que el icono va en
 * dorado. El color de rareza se queda en el borde, el resplandor y la etiqueta
 * de tier —eso es un dato (cuán raro), no un estado del sistema.
 *
 * El nudo de esquina es la única excepción a «un oro por vista»: aquí el oro no
 * marca jerarquía sino estado, igual que el icono. Una rejilla de veinte
 * tarjetas donde sólo una llevara el nudo dorado diría que esa es la más
 * importante, y lo que hay que poder leer de un vistazo es cuáles se ganaron.
 *
 * Es una carta de dos caras (adaptado del «card flip» de Kokonut UI): el
 * anverso es la pieza de colección —medallón, nombre, rareza, y la barra si aún
 * no se tiene—; el reverso, lo que cuesta y cuándo se ganó. La rejilla se lee
 * como una vitrina, y el detalle está a un clic sin estorbar la vista de
 * conjunto. Con movimiento reducido no gira: cambia de cara.
 */
export function AchievementCard({ a }: { a: Achievement }) {
  const tier = TIER_META[a.tier] ?? TIER_META.common;
  const [flipped, setFlipped] = useState(false);
  const reduced = useReducedMotion();

  const face: CSSProperties = {
    // 0.42 dejaba el texto del logro bloqueado en 3.4:1, por debajo de AA.
    opacity: a.unlocked ? 1 : 0.62,
    filter: a.unlocked ? "none" : "grayscale(1)",
    borderColor: a.unlocked ? tier.color : "var(--border)",
    boxShadow: a.unlocked && a.tier !== "common" ? `0 0 14px ${tier.glow}` : "none",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    gridArea: "1 / 1",
  };
  const nudo = (
    <span className={`gr-nudo ${a.unlocked ? "gr-nudo--oro" : "gr-nudo--tinta"}`} style={a.unlocked ? undefined : { opacity: 0.35 }} />
  );

  const front: ReactNode = (
    <div className="card flex flex-col items-center gap-2 text-center" style={face} aria-hidden={flipped}>
      {nudo}
      {/* El medallón: anillo en el color de la rareza y, sólo si está obtenido,
          una tracería de seis puntas alrededor. Un logro bloqueado tiene el
          mismo icono pero no la orla — la diferencia entre saber qué es y
          haberlo conseguido se ve sin leer la fecha. */}
      <span className="relative mt-1 grid h-[64px] w-[64px] shrink-0 place-items-center">
        <svg width="64" height="64" viewBox="0 0 46 46" fill="none" className="absolute inset-0">
          {a.unlocked && <path d={MEDALLION} stroke={tier.color} strokeOpacity="0.5" strokeWidth="0.9" strokeLinejoin="round" />}
          <circle cx="23" cy="23" r="17" stroke={a.unlocked ? tier.color : "var(--gr-edge)"} strokeWidth="1" />
        </svg>
        <span style={{ color: a.unlocked ? "var(--gr-gilded-bright)" : "var(--text-muted)" }}>
          <TablerIcon name={a.icon} size={24} />
        </span>
      </span>
      <div className="font-display text-base leading-tight text-[var(--text-primary)] [text-wrap:balance]">{a.name}</div>
      <div className="font-label text-2xs uppercase tracking-[0.2em]" style={{ color: tier.color }}>{tier.label}</div>
      {!a.unlocked && (
        <div className="mt-auto flex w-full items-center gap-2 pt-1">
          {/* En progreso todavía no es recompensa: la barra va en el color
              de la rareza a media opacidad, nunca en oro. */}
          <span className="h-[5px] flex-1 overflow-hidden rounded-sm border border-[var(--gr-edge)] bg-[var(--gr-surface-sunken)]">
            <span className="block h-full rounded-sm" style={{ width: `${Math.round(a.progress * 100)}%`, background: tier.color, opacity: 0.75 }} />
          </span>
          <span className="shrink-0 tabular text-2xs font-semibold text-[var(--text-faint)]">{Math.round(a.progress * 100)}%</span>
        </div>
      )}
    </div>
  );

  const back: ReactNode = (
    <div className="card flex flex-col gap-2" style={{ ...face, transform: reduced ? undefined : "rotateY(180deg)" }} aria-hidden={!flipped}>
      {nudo}
      <div className="font-label text-2xs uppercase tracking-[0.2em]" style={{ color: tier.color }}>{tier.label}</div>
      <div className="font-display text-sm leading-tight text-[var(--text-primary)]">{a.name}</div>
      <p className="text-xs leading-snug text-[var(--text-body)] [text-wrap:pretty]">{a.description}</p>
      <div className="mt-auto pt-1">
        {a.unlocked ? (
          <span className="font-label text-2xs tracking-[0.1em] text-[var(--purple-main)]">
            {a.unlocked_at
              ? `GANADO EL ${new Date(a.unlocked_at).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}`
              : "DESBLOQUEADO"}
          </span>
        ) : (
          <span className="font-label text-2xs tracking-[0.1em] text-[var(--text-muted)]">
            LLEVAS {Math.round(a.progress * 100)}% · FALTA {100 - Math.round(a.progress * 100)}%
          </span>
        )}
      </div>
    </div>
  );

  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      aria-pressed={flipped}
      aria-label={`${a.name}. ${flipped ? "Ver el anverso" : "Ver el detalle"}`}
      className="block w-full text-left [perspective:900px]"
    >
      {reduced ? (
        <div className="grid">{flipped ? back : front}</div>
      ) : (
        <motion.div
          className="grid"
          style={{ transformStyle: "preserve-3d" }}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 160, damping: 18 }}
          whileHover={{ y: -2 }}
        >
          {front}
          {back}
        </motion.div>
      )}
    </button>
  );
}

/** Seis puntas alrededor del icono. Sólo la lleva un logro obtenido: es la
 *  misma tracería del panel «el más cercano», a otro tamaño y otro recuento. */
const MEDALLION = tracery(23, 19, 22, 6);
