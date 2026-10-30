import { chartPalette } from "./theme-tokens";
import { isReduced } from "./motion-pref";

/**
 * Motas de pan de oro que saltan del control que acaba de pagar XP. Adaptado
 * del estallido del «particle button» de Kokonut UI.
 *
 * No envuelve ningún botón: se dispara desde `handleXP` (context.tsx), que es
 * el único sitio por el que pasa todo el XP de la app, y sale del último
 * control pulsado. Así lo tienen a la vez marcar un hábito, cerrar una tarea,
 * reclamar una misión o asentar un gasto, y ninguna de esas vistas sabe que
 * existe. Sólo salta con `xp_earned > 0`: el oro es lo ganado, y un acto que no
 * pagó no puede soltar oro.
 */

let lastPressed: Element | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => { lastPressed = (e.target as Element | null)?.closest("button, [role='button'], [role='checkbox']") ?? null; },
    { capture: true },
  );
}

const COUNT = 18;
const GRAVITY = 0.0016; // px/ms²
const DRAG = 0.0022; // fracción de velocidad perdida por ms
const LIFETIME = 650;

/** Suelta el estallido sobre el último control pulsado, si sigue en pantalla. */
export function burstFromLastPress() {
  const el = lastPressed;
  if (!el || !el.isConnected || isReduced()) return;
  const r = el.getBoundingClientRect();
  if (r.width === 0) return;
  burstAt(r.left + r.width / 2, r.top + r.height / 2);
}

export function burstAt(x: number, y: number) {
  const pal = chartPalette();
  const colors = [pal.gilded, pal.gildedBright];
  const size = 220;
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  Object.assign(canvas.style, {
    position: "fixed", left: `${x - size / 2}px`, top: `${y - size / 2}px`,
    width: `${size}px`, height: `${size}px`, pointerEvents: "none", zIndex: "130",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);

  const ps = Array.from({ length: COUNT }, (_, i) => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const v = 0.18 + Math.random() * 0.24;
    const chip = i % 3 === 0;
    return {
      x: size / 2 + (Math.random() - 0.5) * 16, y: size / 2,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      angle: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.02,
      w: chip ? 5 : 3, h: chip ? 2 : 3, color: colors[i % 2],
    };
  });

  const start = performance.now();
  let last = start;
  const tick = (now: number) => {
    const dt = Math.min(now - last, 32);
    last = now;
    const t = (now - start) / LIFETIME;
    ctx.clearRect(0, 0, size, size);
    if (t >= 1) { canvas.remove(); return; }
    ctx.globalAlpha = 1 - t * t;
    for (const p of ps) {
      p.vx *= 1 - DRAG * dt;
      p.vy = p.vy * (1 - DRAG * dt) + GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
