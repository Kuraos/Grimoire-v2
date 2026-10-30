import { useState } from "react";
import { IconX } from "@tabler/icons-react";

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))];
}

export function TagInput({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const tags = parseTags(value);
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const next = [...new Set([...tags, ...parseTags(raw)])];
    onChange(next.join(","));
    setDraft("");
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t).join(","));

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--border-accent)] bg-[var(--bg-elevated)] px-2 py-1.5">
      {tags.map((t) => (
        /* Una etiqueta es metadata, no acento: chip en tinta. */
        <span key={t} className="flex items-center gap-1 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
          {t}
          <button onClick={() => remove(t)} className="text-[var(--text-faint)] hover:text-[var(--gr-ink-bright)]"><IconX size={10} /></button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && draft.trim()) { e.preventDefault(); commit(draft); }
          else if (e.key === "Backspace" && !draft && tags.length) remove(tags[tags.length - 1]);
        }}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={tags.length ? "" : "etiquetas…"}
        className="min-w-[80px] flex-1 bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
      />
    </div>
  );
}
