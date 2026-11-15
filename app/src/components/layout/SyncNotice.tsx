import { IconCloudOff, IconRefresh } from "@tabler/icons-react";

/**
 * El aviso global de sincronización (fase-2-transversal.md, decisión B; fila 48). Componente nuevo:
 * la v1 tenía una franja roja de «sin conexión» porque sin servidor no funcionaba; la v2 sí funciona,
 * así que el aviso es pequeño, en tinta tenue y en el cromo, y dice cuánto falta por subir.
 * Sin texto no ocupa nada.
 */
export function SyncNotice({ text, offline }: { text: string | null; offline: boolean }) {
  if (!text) return null;
  const Icon = offline ? IconCloudOff : IconRefresh;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-1.5 py-1 text-2xs font-label text-[var(--text-muted)]"
      style={{ background: "var(--gr-chrome)", borderBottom: "0.5px solid var(--border)" }}
    >
      <Icon size={12} aria-hidden />
      {text}
    </div>
  );
}
