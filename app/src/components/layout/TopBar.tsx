import { useState } from "react";
import { IconHexagon, IconHeartFilled, IconHeart, IconPencil, IconCheck, IconSettings } from "@tabler/icons-react";
import { romanDate } from "../../utils";
import { useApp, useUser } from "../../context";
import { Api } from "../../api/endpoints";
import { SettingsModal } from "./SettingsModal";

const MAX_LIVES = 3;

export function TopBar() {
  const user = useUser();
  const { refreshUser } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const startEdit = () => { setName(user?.name ?? ""); setEditing(true); };
  const save = async () => {
    if (name.trim()) { try { await Api.updateUser({ name: name.trim() }); await refreshUser(); } catch { /* */ } }
    setEditing(false);
  };

  return (
    <header
      className="flex h-[42px] items-center gap-3 px-4"
      style={{ background: "var(--gr-chrome)", borderBottom: "0.5px solid var(--border)" }}
    >
      <IconHexagon size={18} className="text-[var(--gr-gilded)]" />
      {/* El hexágono dorado ya es la marca; el logotipo en tinta evita que el
          cromo compita con la recompensa. */}
      <span className="font-display text-base font-bold tracking-[0.15em] text-[var(--text-primary)]">
        Grimoire
      </span>
      {user && (
        editing ? (
          <span className="ml-3 flex items-center gap-1">
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
              className="w-32 rounded border border-[var(--border-accent)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs text-[var(--text-primary)] outline-none"
            />
            <button onClick={save} className="text-[var(--purple-main)] hover:text-[var(--gr-arcane-bright)]"><IconCheck size={14} /></button>
          </span>
        ) : (
          <span className="group ml-3 flex items-center gap-1 text-xs italic text-[var(--text-body)]">
            {user.name} · {user.title}
            <button onClick={startEdit} title="Editar nombre" className="text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--purple-main)]">
              <IconPencil size={12} />
            </button>
          </span>
        )
      )}

      {user && (
        <span className="ml-3 flex items-center gap-0.5" title={`${user.lives} vidas`}>
          {Array.from({ length: MAX_LIVES }).map((_, i) =>
            i < user.lives
              ? <IconHeartFilled key={i} size={14} className="text-[var(--gr-oxblood)]" />
              : <IconHeart key={i} size={14} className="text-[var(--text-faint)]" />
          )}
        </span>
      )}

      <span className="ml-auto text-xs italic tabular text-[var(--text-muted)]">
        {romanDate(new Date())}
      </span>

      <button
        onClick={() => setSettingsOpen(true)}
        title="Ajustes"
        className="ml-3 text-[var(--text-faint)] hover:text-[var(--purple-main)]"
      >
        <IconSettings size={16} />
      </button>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
