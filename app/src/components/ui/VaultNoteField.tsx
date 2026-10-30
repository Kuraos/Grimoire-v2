import { IconCopy } from "@tabler/icons-react";
import { useApp } from "../../context";

/** Free-text pointer to an Obsidian note (no file picker, no existence check).
 *  Shows a copy-to-clipboard button when a path is present. */
export function VaultNoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { pushToast } = useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      pushToast({ title: "Copiado", body: "Ruta de la nota copiada", icon: "copy" });
    } catch {
      pushToast({ title: "Error", body: "No se pudo copiar", icon: "alert-triangle", variant: "error" });
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input
        className="input flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ruta/dentro-del-vault/nota.md"
      />
      {value.trim() !== "" && (
        <button onClick={copy} title="Copiar ruta al portapapeles"
          className="btn shrink-0" type="button">
          <IconCopy size={14} />
        </button>
      )}
    </div>
  );
}
