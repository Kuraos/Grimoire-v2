import { useEffect, useState, type ReactNode } from "react";
import { Field } from "./components/ui/Modal";
import { loadToken, onUnauthorized, saveToken } from "./api/client";
import { queryClient } from "./api/queryClient";

/** Sin token no hay API: lo pide una vez y lo vuelve a pedir si el servidor lo rechaza. */
export function TokenGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    loadToken().then((t) => setReady(t !== null), () => setReady(false));
    return onUnauthorized(() => {
      queryClient.clear();
      setReady(false);
    });
  }, []);

  if (ready === null) return null;
  if (ready) return children;

  return (
    <div className="gr-cielo flex h-dvh items-center justify-center p-4">
      <form
        className="card w-full max-w-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          await saveToken(draft.trim());
          setDraft("");
          setReady(true);
        }}
      >
        <Field label="Token de la API">
          <input className="input" type="password" autoComplete="off" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
        </Field>
        <button className="btn btn-primary w-full justify-center" type="submit">Guardar</button>
      </form>
    </div>
  );
}
