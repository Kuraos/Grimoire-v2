import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { IconChevronRight, IconSearch } from "@tabler/icons-react";
import { TablerIcon } from "../TablerIcon";
import { usePomodoroCtx } from "../../pomodoro-context";
import { fuzzyMatch } from "../../fuzzy";

/**
 * Paleta de comandos (Ctrl/Cmd+K). Rehecha a partir de la «action search bar»
 * de Kokonut UI: búsqueda aproximada que ignora tildes, letras que casan
 * resaltadas, grupos, y páginas anidadas —una acción puede abrir su propia
 * lista, como «Vincular tarea al Pomodoro…»—. Retroceso con la búsqueda vacía
 * vuelve a la página anterior.
 *
 * Faltaban Entrenamiento y Erario: la paleta listaba nueve de las once vistas
 * del Sidebar.
 */
interface Command {
  id: string;
  label: string;
  group: string;
  icon: string;
  hint?: string;
  keywords?: string[];
  run?: () => void;
  /** Abre una página propia en vez de ejecutarse. */
  page?: () => Command[];
}

const VIEWS: [string, string, string, string[]?][] = [
  ["/", "Dashboard", "layout-dashboard", ["hoy", "inicio"]],
  ["/habitos", "Hábitos", "repeat", ["ritos", "rachas"]],
  ["/tareas", "Tareas y Proyectos", "list-check", ["kanban"]],
  ["/pomodoro", "Pomodoro", "clock", ["foco"]],
  ["/calendario", "Calendario", "calendar", ["eventos"]],
  ["/diario", "Diario", "book", ["entrada"]],
  ["/entrenamiento", "Entrenamiento", "barbell", ["palestra", "gym", "fuerza"]],
  ["/erario", "Erario", "coins", ["finanzas", "gastos", "dinero"]],
  ["/estadisticas", "Estadísticas", "chart-bar", ["gráficos"]],
  ["/logros", "Logros", "trophy"],
  ["/revision", "Revisión semanal", "notebook"],
];

export function CommandPalette() {
  const nav = useNavigate();
  const pomo = usePomodoroCtx();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [stack, setStack] = useState<Command[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setStack([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const root = useMemo<Command[]>(() => [
    ...VIEWS.map(([path, label, icon, keywords]) => ({
      id: path, label, icon, keywords, group: "Ir a",
      run: () => { nav(path); close(); },
    })),
    {
      id: "pomo-toggle", group: "Acciones",
      label: pomo.running ? "Pausar Pomodoro" : "Iniciar Pomodoro",
      hint: "Espacio",
      icon: pomo.running ? "player-pause" : "player-play",
      run: () => { pomo.running ? pomo.pause() : pomo.start(); close(); },
    },
    {
      id: "pomo-task", group: "Acciones", label: "Vincular tarea al Pomodoro…", icon: "link", keywords: ["foco", "tarea"],
      page: () => pomo.tasks
        .filter((t) => t.status !== "done")
        .map((t) => ({
          id: `t${t.id}`, group: "Tareas pendientes", label: t.title, icon: "checkbox",
          run: () => { pomo.startWithTask(t); close(); },
        })),
    },
  ], [nav, pomo]);

  const page = stack.at(-1);
  const items = useMemo(() => (page?.page ? page.page() : root), [page, root]);

  const rows = useMemo(() => {
    const q = query.trim();
    if (!q) return items.map((c) => ({ c, matches: [] as number[] }));
    return items
      .map((c) => {
        const hit = fuzzyMatch(c.label, q);
        if (hit) return { c, matches: hit.matches, score: hit.score };
        // Una palabra clave encuentra la fila, más abajo y sin resaltar.
        const kw = Math.max(-Infinity, ...(c.keywords ?? []).map((k) => fuzzyMatch(k, q)?.score ?? -Infinity));
        return kw > -Infinity ? { c, matches: [], score: kw / 2 } : null;
      })
      .filter((r): r is { c: Command; matches: number[]; score: number } => r !== null)
      .sort((a, b) => b.score - a.score);
  }, [items, query]);

  const choose = (c?: Command) => {
    if (!c) return;
    if (c.page) { setStack((s) => [...s, c]); setQuery(""); setActive(0); return; }
    c.run?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(rows[active]?.c); }
    else if (e.key === "Backspace" && query === "" && stack.length) { e.preventDefault(); setStack((s) => s.slice(0, -1)); setActive(0); }
  };

  let lastGroup = "";
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-overlay=""
          className="fixed inset-0 z-[110] flex items-start justify-center bg-[rgba(5,3,8,0.6)] pt-[12vh]"
          onClick={close}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="w-[520px] max-w-[92vw] overflow-hidden rounded-lg border border-[var(--border-accent)] bg-[var(--bg-deep)] shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
              <IconSearch size={16} className="shrink-0 text-[var(--text-muted)]" />
              {stack.map((p) => (
                <span key={p.id} className="flex shrink-0 items-center gap-1 rounded border border-[var(--border-accent)] px-1.5 py-0.5 text-xs text-[var(--gr-arcane-bright)]">
                  {p.label.replace("…", "")}
                </span>
              ))}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder={page ? "Buscar…" : "Saltar a… o ejecutar una acción"}
                className="w-full bg-transparent text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <kbd className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">Esc</kbd>
            </div>
            <div className="max-h-[340px] overflow-y-auto py-1">
              {rows.length === 0 && <div className="px-4 py-3 text-sm text-[var(--text-muted)]">Sin resultados.</div>}
              {rows.map(({ c, matches }, i) => {
                const header = !query && c.group !== lastGroup ? c.group : null;
                lastGroup = c.group;
                return (
                  <Fragment key={c.id}>
                    {header && <div className="px-4 pb-1 pt-2 font-label text-2xs uppercase tracking-[0.12em] text-[var(--text-faint)]">{header}</div>}
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(c)}
                      className={`relative flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${i === active ? "text-[var(--text-primary)]" : "text-[var(--text-body)]"}`}
                    >
                      {i === active && (
                        <motion.span layoutId="paleta-activa" className="absolute inset-x-1.5 inset-y-0 rounded-md bg-[var(--bg-elevated)]"
                                     transition={{ type: "spring", stiffness: 520, damping: 40 }} />
                      )}
                      <TablerIcon name={c.icon} size={16} className="relative text-[var(--purple-main)]" />
                      <span className="relative flex-1 truncate"><Marked text={c.label} at={matches} /></span>
                      {c.hint && <kbd className="relative rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">{c.hint}</kbd>}
                      {c.page && <IconChevronRight size={14} className="relative text-[var(--text-muted)]" />}
                    </button>
                  </Fragment>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Las letras que casan, en arcano brillante: la búsqueda enseña por qué encontró. */
function Marked({ text, at }: { text: string; at: number[] }) {
  if (!at.length) return <>{text}</>;
  const set = new Set(at);
  return <>{Array.from(text, (ch, i) => set.has(i) ? <span key={i} className="text-[var(--gr-arcane-bright)]">{ch}</span> : ch)}</>;
}
