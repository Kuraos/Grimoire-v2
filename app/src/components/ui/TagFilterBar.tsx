import { IconTag } from "@tabler/icons-react";

export function TagFilterBar({ tags, active, onSelect }: {
  tags: string[];
  active: string | null;
  onSelect: (t: string | null) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <IconTag size={13} className="text-[var(--text-muted)]" />
      <button
        onClick={() => onSelect(null)}
        className="rounded-full border px-2 py-0.5 text-xs"
        style={{
          borderColor: active === null ? "var(--border-glow)" : "var(--border)",
          color: active === null ? "var(--purple-main)" : "var(--text-muted)",
        }}
      >
        Todas
      </button>
      {tags.map((t) => (
        <button
          key={t}
          onClick={() => onSelect(t)}
          className="rounded-full border px-2 py-0.5 text-xs"
          style={{
            borderColor: active === t ? "var(--border-glow)" : "var(--border)",
            color: active === t ? "var(--purple-main)" : "var(--text-body)",
            background: active === t ? "var(--bg-elevated)" : "transparent",
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
