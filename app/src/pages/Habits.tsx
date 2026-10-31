import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { IconPlus, IconArchive, IconFlame, IconEdit, IconX, IconTag, IconTrash, IconCalendar } from "@tabler/icons-react";
import { useHabitActions, useHabitDetail, useHabitHeatmap, useHabits } from "../api/habits";
import { useCategoryActions, useHabitCategories } from "../api/categories";
import { useApp } from "../context";
import { Card } from "../components/ui/Card";
import { Figure } from "../components/ui/Figure";
import { SectionBand } from "../components/ui/SectionBand";
import { Skeleton } from "../components/ui/Skeleton";
import { sigilDeCategoria } from "../components/ui/Sigil";
import { PageHeader } from "../components/layout/PageHeader";
import { HabitCardGothic } from "../components/ui/HabitCardGothic";
import { Modal, Overlay, Field, useSheetDrag } from "../components/ui/Modal";
import { HabitHeatmap } from "../components/charts/HabitHeatmap";
import { HabitConstellation } from "../components/charts/HabitConstellation";
import { HabitXPChart } from "../components/charts/HabitXPChart";
import { TagInput } from "../components/ui/TagInput";
import { chartPalette } from "../theme-tokens";
import { confirm } from "../confirm";
import { WEEKDAYS_ES, WEEKDAY_NAMES_ES, habitDays, streakUnit } from "../utils";
import type { Habit, HabitCategory, HabitDetail } from "../types";

/** La rampa de `HabitHeatmap`, entre los dos mismos tokens. */
const LEYENDA = [0, 33, 66, 100].map((p) => `color-mix(in srgb, var(--gr-arcane) ${p}%, var(--gr-surface-raised))`);

export default function Habits() {
  const { handleXP, pushToast } = useApp();
  const [catsOpen, setCatsOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const habitsQuery = useHabits(showArchived);
  const habits = habitsQuery.data ?? [];
  const categories = useHabitCategories().data ?? [];
  const heat = useHabitHeatmap().data ?? [];
  const detail = useHabitDetail(detailId).data;
  const actions = useHabitActions();
  const opened = habits.find((h) => h.id === detailId);

  // Hasta que la 2.1.6 sea optimista, un segundo toque antes del refresco daría un 409.
  const complete = async (h: Habit) => {
    if (actions.pending) return;
    try {
      handleXP(await actions.complete(h.id));
    } catch { /* el error ya salió como toast */ }
  };

  const undo = async (h: Habit) => {
    if (actions.pending || !h.last_mark) return;
    try {
      await actions.undo(h.id, h.last_mark.id);
    } catch { /* el error ya salió como toast */ }
  };

  // archivar es un borrado suave: el historial sigue ahí y debe poder recuperarse
  const restore = async (h: Habit) => {
    try {
      await actions.restore(h.id);
      pushToast({ title: "Hábito restaurado", body: h.name, icon: "arrow-back-up" });
    } catch { /* el error ya salió como toast */ }
  };

  const archive = async (h: Habit) => {
    if (!(await confirm({ message: `¿Archivar «${h.name}»? Conserva su historial pero deja de aparecer.`, confirmLabel: "Archivar", danger: true }))) return;
    try {
      await actions.archive(h.id);
      setDetailId(null);
    } catch { /* el error ya salió como toast */ }
  };

  // catalog order first, then any category still used by habits but not in the
  // catalog (e.g. deleted or legacy) so no habit ever disappears from the list
  const catalogNames = categories.map((c) => c.name);
  const orphanNames = [...new Set(habits.map((h) => h.category))].filter((c) => !catalogNames.includes(c));
  const byCategory = [...catalogNames, ...orphanNames].map((cat) => ({
    cat,
    items: habits.filter((h) => h.category === cat),
  })).filter((g) => g.items.length > 0);

  /* Las cifras de la cabecera y de la rúbrica cuentan sobre los ACTIVOS.
     Con «Ver archivados» puesto, `habits` trae también los archivados y la línea
     seguía diciendo «N activos»; la constancia media se diluía con hábitos que
     ya nadie lleva, y la racha más larga podía ser la de uno abandonado. */
  const activos = habits.filter((h) => h.active);
  // el titular de la racha, no sólo su número: en un hábito semanal se cuenta
  // en semanas, y rotularlo «días» es decir otra cosa
  const record = activos.reduce<Habit | null>(
    (best, h) => (!best || h.streak > best.streak ? h : best), null,
  );
  const bestStreak = record?.streak ?? 0;
  const avgRate = activos.length
    ? Math.round(activos.reduce((s, h) => s + h.completion_rate, 0) / activos.length)
    : 0;
  const marks = heat.reduce((s, d) => s + d.count, 0);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <PageHeader
        title="Hábitos"
        className="lg:col-span-3"
        context={
          `${activos.length} activos · ${activos.filter((h) => h.done_today).length} cumplidos hoy` +
          // sin racha viva la cláusula era «racha más larga 0 días», que ocupa
          // sitio para no decir nada
          (record && bestStreak > 0 ? ` · racha más larga ${bestStreak} ${streakUnit(record, bestStreak)}` : "")
        }
      >
        <button
          className="btn"
          onClick={() => setShowArchived((v) => !v)}
          title={showArchived ? "Ocultar los archivados" : "Mostrar también los archivados"}
          aria-label={showArchived ? "Ocultar archivados" : "Ver archivados"}
          aria-pressed={showArchived}
          style={showArchived ? { borderColor: "var(--gr-edge-focus)", color: "var(--gr-arcane)" } : undefined}
        >
          {/* En teléfono, una sola fila: el texto no cabe y le robaba la pantalla a la lista. */}
          <IconArchive size={14} /> <span className="hidden lg:inline">{showArchived ? "Ocultar archivados" : "Ver archivados"}</span>
        </button>
        <button className="btn" onClick={() => setCatsOpen(true)} aria-label="Categorías" title="Categorías">
          <IconTag size={14} /> <span className="hidden lg:inline">Categorías</span>
        </button>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus size={14} /> Nuevo hábito
        </button>
      </PageHeader>

      {/* La rúbrica ocupa el ancho entero y lleva el mapa a la izquierda con
          las tres cifras del año a la derecha: el mapa dice la forma y las
          cifras la magnitud, y separados en dos cards no se leían juntos. */}
      <Card rank="rubric" title="Consistencia · 12 meses" icon={<IconCalendar size={14} />} className="min-w-0 lg:col-span-3">
        <div className="flex flex-wrap items-start gap-7">
          <div className="min-w-0 flex-1 basis-full lg:basis-0">
            <HabitHeatmap data={heat} />
            <div className="mt-2.5 flex flex-wrap items-center gap-2 font-label text-2xs text-[var(--text-faint)]">
              <span>menos</span>
              {LEYENDA.map((c) => (
                <span key={c} className="h-[11px] w-[11px] rounded-xs" style={{ background: c }} />
              ))}
              <span>más</span>
              <span className="ml-3 h-[11px] w-[11px] rounded-xs bg-[var(--gr-surface-raised)] outline outline-1 outline-[var(--gr-arcane)]" />
              <span>hoy</span>
            </div>
          </div>
          <div className="grid w-full grid-cols-3 gap-x-4 lg:flex lg:w-auto lg:gap-7">
            <Figure value={bestStreak} label="Racha más larga" gold />
            <Figure value={avgRate} suffix="%" label="Constancia · 90 días" />
            <Figure value={marks} label="Marcas en 12 meses" />
          </div>
        </div>
      </Card>

      <div className="min-w-0 space-y-1 lg:col-span-2">
        {habitsQuery.isPending && (
          <div className="space-y-2 pt-2.5">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
          </div>
        )}
        {habitsQuery.isError && !habitsQuery.data && (
          <Card>
            <p className="gr-sangrado text-xs text-[var(--text-muted)]">No se pudieron cargar los hábitos.</p>
            <button className="btn mt-2" onClick={() => habitsQuery.refetch()}>Reintentar</button>
          </Card>
        )}
        {habitsQuery.data && byCategory.length === 0 && (
          <Card><p className="gr-sangrado text-xs text-[var(--text-muted)]">Aún no hay hábitos activos.</p></Card>
        )}
        {/* Cada categoría cuelga de su sigilo y de una espina: la marca dice qué
            grupo es antes de leer el rótulo, y la espina ata las tarjetas al
            bloque en vez de dejarlas sueltas bajo un título. */}
        {byCategory.map((g) => (
          <div key={g.cat} className="pt-2.5">
            <SectionBand
              sigil={sigilDeCategoria(g.cat)}
              label={g.cat}
              count={g.items.length}
              fill="linea"
              spine
            >
              <div className="space-y-2">
                {g.items.map((h) => (
                  <HabitCardGothic key={h.id} habit={h} onComplete={complete} onUndo={undo} onOpen={(x) => setDetailId(x.id)} onRestore={restore} />
                ))}
              </div>
            </SectionBand>
          </div>
        ))}
      </div>

      <div className="min-w-0 space-y-3">
        <HabitConstellation habits={habits} />
      </div>

      {/* Fuera de las columnas: es una capa sobre la vista, no una card de la
          rejilla. Dejarlo dentro funcionaba —está en `fixed`— pero el marcado
          decía lo contrario de lo que hace. */}
      {opened && (
        <DetailPanel
          habit={opened}
          detail={detail?.id === opened.id ? detail : undefined}
          onClose={() => setDetailId(null)}
          onArchive={archive}
          onEdit={() => { setEditing(opened); setDetailId(null); }}
        />
      )}

      {(creating || editing) && (
        <HabitForm
          habit={editing}
          categories={categories}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}

      {catsOpen && (
        <CategoriesModal
          categories={categories}
          onClose={() => setCatsOpen(false)}
          notify={pushToast}
        />
      )}
    </div>
  );
}


function CategoriesModal({ categories, onClose, notify }: {
  categories: HabitCategory[];
  onClose: () => void;
  notify: (t: { title: string; body: string; icon?: string; variant?: "default" | "error" }) => void;
}) {
  const [name, setName] = useState("");
  // <input type="color"> exige un hex literal: con var(...) caería a negro
  const [color, setColor] = useState(() => chartPalette().arcane);
  const actions = useCategoryActions();

  const add = async () => {
    if (!name.trim() || actions.pending) return;
    try {
      await actions.create(name.trim(), color);
      setName("");
    } catch { /* el error ya salió como toast (p. ej. duplicada) */ }
  };

  const remove = async (c: HabitCategory) => {
    if (c.habit_count > 0) {
      notify({
        title: "No se puede eliminar",
        body: `«${c.name}» está en uso por ${c.habit_count} hábito(s).`,
        icon: "alert-triangle",
        variant: "error",
      });
      return;
    }
    if (!(await confirm({ message: `¿Eliminar la categoría «${c.name}»?`, danger: true }))) return;
    try {
      await actions.remove(c.id);
    } catch { /* el error ya salió como toast */ }
  };

  return (
    <Modal title="Categorías de hábitos" onClose={onClose}>
      <div className="mb-3 space-y-1">
        {categories.length === 0 && (
          <p className="text-xs text-[var(--text-muted)]">Sin categorías.</p>
        )}
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2 border-b border-[var(--gr-edge)] py-1.5 last:border-none">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
            <span className="flex-1 text-sm text-[var(--text-body)]">{c.name}</span>
            <span className="tabular text-xs text-[var(--text-muted)]">
              {c.habit_count} hábito{c.habit_count === 1 ? "" : "s"}
            </span>
            <button
              onClick={() => remove(c)}
              aria-label={`Eliminar ${c.name}`}
              title={c.habit_count > 0 ? "En uso — reasigna esos hábitos primero" : "Eliminar"}
              className={`gr-tactil relative ${c.habit_count > 0 ? "text-[var(--text-faint)] opacity-40" : "text-[var(--text-faint)] hover:text-[var(--gr-oxblood)]"}`}
            >
              <IconTrash size={13} />
            </button>
          </div>
        ))}
      </div>

      <Field label="Nueva categoría">
        <div className="flex items-center gap-2">
          <input
            className="input flex-1"
            value={name}
            placeholder="p. ej. Música"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <input type="color" className="input h-9 w-12 shrink-0 p-1" value={color} onChange={(e) => setColor(e.target.value)} />
          <button className="btn shrink-0" onClick={add} disabled={actions.pending} aria-label="Agregar categoría"><IconPlus size={13} /></button>
        </div>
      </Field>
      <p className="text-xs italic text-[var(--text-muted)]">
        Solo se pueden eliminar categorías que ningún hábito esté usando.
      </p>

      <div className="mt-3 flex justify-end">
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

/**
 * El detalle de un hábito, como pliego suelto sobre la vista.
 *
 * Era una card más en la columna derecha, debajo del heatmap: para leer la
 * racha de un hábito había que buscar dónde había aparecido el panel, y con la
 * constelación al lado competían dos cosas por el mismo sitio. Abierto encima
 * y centrado, el hábito es lo único que hay mientras se mira. En teléfono es una
 * hoja inferior, como todo diálogo.
 *
 * Las cuatro cifras van en cajas hundidas y grandes —es lo que se viene a ver—,
 * y tres de las cuatro en oro: racha, mejor racha y XP son lo que se ganó.
 * La constancia es un porcentaje, o sea dato, y se queda en tinta.
 */
function DetailPanel({ habit, detail, onClose, onArchive, onEdit }: {
  habit: Habit; detail?: HabitDetail; onClose: () => void; onArchive: (h: Habit) => void; onEdit: () => void;
}) {
  const { sheet, handle } = useSheetDrag(onClose);
  const best = detail?.best_streak;
  return (
    <Overlay onClose={onClose} align="start">
      <motion.div
        {...sheet}
        className="card card-rubric max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-b-none pb-[calc(18px+env(safe-area-inset-bottom))] lg:max-h-none lg:overflow-visible lg:rounded-b-lg lg:pb-[18px]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={habit.name}
      >
        <span className="gr-nudo gr-nudo--oro" />
        <span className="gr-nudo gr-nudo--oro gr-nudo--contra" />

        <div {...handle} className="gr-sangrado mb-4 flex items-center gap-3">
          <h2 className="gr-rubrica">{habit.name}</h2>
          <button onClick={onClose} title="Cerrar" aria-label="Cerrar"
                  className="-m-3 ml-auto p-3 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <IconX size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {/* La unidad la manda la cadencia: la racha de un hábito semanal se
              cuenta en semanas, y «4 días» donde son cuatro semanas es un dato
              distinto, no una abreviatura. */}
          <Metric label="Racha actual" value={`${habit.streak} ${streakUnit(habit, habit.streak)}`} icon={<IconFlame size={16} />} gold />
          <Metric label="Mejor racha" value={best === undefined ? "—" : `${best} ${streakUnit(habit, best)}`} gold />
          <Metric label="Constancia · 90 días" value={`${habit.completion_rate}%`} />
          <Metric label="XP total" value={detail ? detail.total_xp.toLocaleString("es") : "—"} gold />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="font-label text-xs text-[var(--text-muted)]">XP acumulado</span>
            <span className="gr-filete" />
            <span className="gr-rombo" />
          </div>
          <HabitXPChart series={detail?.xp_series ?? []} />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="font-label text-xs text-[var(--text-muted)]">Historial</span>
            <span className="gr-filete" />
            <span className="gr-rombo" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {detail?.marks.length === 0 && <p className="text-xs text-[var(--text-muted)]">Sin registros.</p>}
            {detail?.marks.map((m) => (
              <div key={m.id} className="border-b border-[var(--gr-edge)] py-2 text-sm tabular text-[var(--text-body)] last:border-none">
                {new Date(m.completed_at).toLocaleString("es", {
                  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-2.5">
          <button className="btn flex-1 justify-center" onClick={onEdit}><IconEdit size={13} /> Editar</button>
          <button className="btn flex-1 justify-center" onClick={() => onArchive(habit)}><IconArchive size={13} /> Archivar</button>
        </div>
      </motion.div>
    </Overlay>
  );
}

/** `gold` marca lo que el usuario se ha ganado; el resto es dato, y va en tinta. */
function Metric({ label, value, icon, gold }: { label: string; value: string; icon?: ReactNode; gold?: boolean }) {
  return (
    <div className="rounded-md border border-[var(--gr-edge)] bg-[var(--gr-surface-sunken)] px-3.5 py-3">
      <div className="text-2xs font-label text-[var(--text-muted)]">{label}</div>
      <div
        className="mt-1.5 flex items-center gap-1.5 text-xl tabular"
        style={{ color: gold ? "var(--gr-gilded)" : "var(--text-primary)" }}
      >
        {icon}{value}
      </div>
    </div>
  );
}

function HabitForm({ habit, categories, onClose }: {
  habit: Habit | null; categories: HabitCategory[]; onClose: () => void;
}) {
  // <input type="color"> exige un hex literal: con var(...) caería a negro
  const catColor = (n: string) => categories.find((c) => c.name === n)?.color ?? chartPalette().arcane;
  const [name, setName] = useState(habit?.name ?? "");
  const [category, setCategory] = useState(habit?.category ?? categories[0]?.name ?? "Otro");
  const [frequency, setFrequency] = useState(habit?.frequency ?? "daily");
  // vacío = todos los días, que es lo que guarda el backend como NULL
  const [days, setDays] = useState<number[]>(habitDays(habit?.days ?? null) ?? []);
  const [targetPerWeek, setTargetPerWeek] = useState(habit?.target_per_week ?? 1);
  const [xp, setXp] = useState(habit?.xp_reward ?? 20);
  const [color, setColor] = useState(
    habit?.color ?? catColor(habit?.category ?? categories[0]?.name ?? "Otro")
  );
  const [notes, setNotes] = useState(habit?.notes ?? "");
  const [tags, setTags] = useState<string>(habit?.tags ?? "");
  const actions = useHabitActions();

  const save = async () => {
    if (!name.trim() || actions.pending) return;
    const payload = {
      name, category, frequency,
      days: frequency === "daily" && days.length && days.length < 7 ? days.join(",") : null,
      target_per_week: frequency === "weekly" ? targetPerWeek : 1,
      xp_reward: xp, color, notes: notes.trim() || null, tags: tags || null,
    };
    try {
      if (habit) await actions.update(habit.id, payload);
      else await actions.create(payload);
      onClose();
    } catch {
      // el error ya salió como toast; el modal conserva lo escrito
    }
  };

  return (
    <Modal title={habit ? "Editar hábito" : "Nuevo hábito"} onClose={onClose}>
      <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoría">
          <select className="input" value={category} onChange={(e) => { setCategory(e.target.value); setColor(catColor(e.target.value)); }}>
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            {/* keep a habit's legacy category selectable even if it left the catalog */}
            {category && !categories.some((c) => c.name === category) && <option value={category}>{category}</option>}
          </select>
        </Field>
        <Field label="Frecuencia">
          <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="daily">Diario</option>
            <option value="weekly">Semanal</option>
          </select>
        </Field>
      </div>
      {frequency === "daily" ? (
        <Field label="Días en que toca">
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS_ES.map((label, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={days.includes(i)}
                aria-label={WEEKDAY_NAMES_ES[i]}
                title={WEEKDAY_NAMES_ES[i]}
                className={`btn w-9 justify-center px-0 ${days.includes(i) ? "btn-primary" : ""}`}
                onClick={() => setDays((prev) =>
                  prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i].sort((a, b) => a - b)
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="gr-meta mt-1.5" style={{ color: "var(--gr-ink-faint)" }}>
            {days.length === 0 || days.length === 7
              ? "Sin marcar: cuenta todos los días."
              : "Los días sin marcar no suman racha ni la rompen."}
          </p>
        </Field>
      ) : (
        <Field label="Veces por semana">
          <select className="input" value={targetPerWeek}
                  onChange={(e) => setTargetPerWeek(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>{n}× por semana</option>
            ))}
          </select>
          <p className="gr-meta mt-1.5" style={{ color: "var(--gr-ink-faint)" }}>
            La semana cuenta como hecha al alcanzar la meta; máximo una marca por día.
          </p>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`XP por completar (${xp})`}>
          <input type="range" min={10} max={100} step={5} value={xp} onChange={(e) => setXp(Number(e.target.value))} className="w-full" />
        </Field>
        <Field label="Color">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="input h-9 p-1" />
        </Field>
      </div>
      <Field label="Notas (opcional)"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Field label="Etiquetas"><TagInput value={tags} onChange={setTags} /></Field>
      <div className="mt-2 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={actions.pending}>
          {actions.pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}
