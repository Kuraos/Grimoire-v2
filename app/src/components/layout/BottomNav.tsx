import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { IconDots, IconSettings } from "@tabler/icons-react";
import { Modal } from "../ui/Modal";
import { NAV } from "./Sidebar";

/**
 * Navegación de teléfono y tablet vertical (por debajo de lg:, donde manda la
 * Sidebar). Componente nuevo: la v1 no tenía equivalente. Cuatro destinos fijos
 * y «Más» con el resto en una hoja inferior (DESIGN_SYSTEM → «Navegación»).
 * El activo va en arcano —es sistema, no recompensa— con icono y rótulo.
 */
const PRIMARIOS = ["/", "/habitos", "/tareas", "/pomodoro"];
const EN_MAS = ["/diario", "/calendario", "/entrenamiento", "/erario", "/estadisticas", "/logros", "/revision"];
const ROTULO: Record<string, string> = { "/": "Inicio" };

const byPath = (to: string) => NAV.find((n) => n.to === to)!;

const tono = (active: boolean) =>
  active ? "text-[var(--purple-main)]" : "text-[var(--gr-ink-faint)]";

export function BottomNav({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [mas, setMas] = useState(false);
  const { pathname } = useLocation();
  const enMas = EN_MAS.includes(pathname);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-[70] flex pb-[env(safe-area-inset-bottom)] lg:hidden"
        style={{ background: "var(--gr-chrome)", borderTop: "0.5px solid var(--border)" }}
      >
        {PRIMARIOS.map((to) => {
          const { icon: Icon, label } = byPath(to);
          return (
            <NavLink key={to} to={to} end={to === "/"}
              className={({ isActive }) => `flex h-14 flex-1 flex-col items-center justify-center gap-1 ${tono(isActive)}`}>
              <Icon size={20} />
              <span className="text-2xs">{ROTULO[to] ?? label}</span>
            </NavLink>
          );
        })}
        <button onClick={() => setMas(true)}
          className={`flex h-14 flex-1 flex-col items-center justify-center gap-1 ${tono(enMas)}`}>
          <IconDots size={20} />
          <span className="text-2xs">Más</span>
        </button>
      </nav>

      {mas && (
        <Modal title="Más" onClose={() => setMas(false)}>
          <ul className="-mx-2">
            {EN_MAS.map((to) => {
              const { icon: Icon, label } = byPath(to);
              return (
                <li key={to}>
                  <NavLink to={to} onClick={() => setMas(false)}
                    className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-md px-2 text-sm ${
                      isActive ? "text-[var(--purple-main)]" : "text-[var(--text-body)]"}`}>
                    <Icon size={18} /> {label}
                  </NavLink>
                </li>
              );
            })}
            <li>
              <button onClick={() => { setMas(false); onOpenSettings(); }}
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-sm text-[var(--text-body)]">
                <IconSettings size={18} /> Ajustes
              </button>
            </li>
          </ul>
        </Modal>
      )}
    </>
  );
}
