import { IconStarsFilled } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import type { LevelUp } from "../../types";
import { motionTokens } from "../../theme-tokens";

/* Doce motas de pan de oro que salen una vez del centro. Es el único estallido
 * de la app que no pide permiso a nadie: subir de nivel es la recompensa por
 * excelencia, y el oro aquí es literal. */
const MOTAS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const r = 120 + (i % 3) * 28;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, d: (i % 4) * 0.03 };
});

export function LevelUpOverlay({ levelUp, dismissLevelUp }: { levelUp: LevelUp | null; dismissLevelUp: () => void }) {
  const t = motionTokens();

  return (
    <AnimatePresence>
      {levelUp && (
        <motion.div
          key={levelUp.level}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(5,3,8,0.72)]"
          onClick={dismissLevelUp}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: t.enter } }}
          transition={{ duration: t.enter, ease: t.easeOut }}
        >
          <motion.div
            className="relative flex flex-col items-center px-10 py-8 text-center"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
          >
            {/* Halo: respira en opacidad, que no es movimiento; la escala la
                apaga MotionConfig cuando se pide movimiento reducido. */}
            <motion.div
              className="absolute inset-0 -z-10 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(220, 174, 92, 0.45), transparent 65%)" }}
              animate={{ opacity: [0.35, 0.6, 0.35], scale: [1, 1.15, 1] }}
              transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity }}
            />
            {MOTAS.map((m, i) => (
              <motion.span
                key={i}
                className="absolute left-1/2 top-[52px] h-1.5 w-1.5 rounded-full bg-[var(--gr-gilded-bright)]"
                initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
                animate={{ x: m.x, y: m.y, opacity: [0, 1, 0], scale: [0.4, 1, 0.6] }}
                transition={{ duration: 1.1, delay: 0.12 + m.d, ease: t.easeOut }}
              />
            ))}
            <motion.div
              initial={{ rotate: -90, scale: 0 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.05 }}
            >
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 4, ease: "linear", repeat: Infinity }}>
                <IconStarsFilled size={56} className="text-[var(--gr-gilded-bright)]" />
              </motion.div>
            </motion.div>
            <motion.div
              className="mt-3 font-label text-xs uppercase tracking-[0.3em] text-[var(--text-muted)]"
              initial={{ opacity: 0, letterSpacing: "0.6em" }}
              animate={{ opacity: 1, letterSpacing: "0.3em" }}
              transition={{ duration: t.reward, delay: 0.15, ease: t.easeOut }}
            >
              Ascensión
            </motion.div>
            <motion.div
              className="mt-1 font-display text-3xl font-bold leading-none text-[var(--gr-gilded-bright)]"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: t.reward, delay: 0.25, ease: t.easeReward }}
            >
              Nivel {levelUp.level}
            </motion.div>
            <motion.div
              className="mt-2 font-display text-base italic tracking-wide text-[var(--gr-gilded)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: t.reward, delay: 0.4 }}
            >
              {levelUp.title}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
