import { useMemo, useState } from "react";
import { IconArrowDown, IconArrowUp, IconCheck, IconFilter, IconPlus, IconFolder, IconTrash, IconEdit, IconList, IconLayoutKanban, IconChecklist } from "@tabler/icons-react";
import { useIsDesktop } from "../hooks/useMediaQuery";
import { dismissQueueEntry } from "../api/queryClient";
import { projectActions, useProjects } from "../api/projects";
import { rankAtEnd, remindAtToLocal, remindAtToUtc, sortTasks, stepNeighbours, taskActions, useTaskHistory, useTasks } from "../api/tasks";
import { Card } from "../components/ui/Card";
import { Segmented } from "../components/ui/Segmented";
import { SectionBand } from "../components/ui/SectionBand";
import { Skeleton } from "../components/ui/Skeleton";
import { ProgressSigil } from "../components/ui/ProgressSigil";
import { PageHeader } from "../components/layout/PageHeader";
import { TaskCard } from "../components/ui/TaskCard";
import { COLUMNS, KanbanBoard } from "../components/ui/KanbanBoard";
import { parseTags, TagInput } from "../components/ui/TagInput";
import { TagFilterBar } from "../components/ui/TagFilterBar";
import { Modal, Field } from "../components/ui/Modal";
import { confirm } from "../confirm";
import { CATEGORY_COLORS, isoDate } from "../utils";
import type { ApiChecklistItem, ApiProject, ApiTask } from "../types";

const PROJECT_CATEGORIES = ["Académico", "Personal", "TCG", "Trabajo"];
const STATUS_LABEL: Record<string, string> = { active: "Activo", paused: "Pausado", closed: "Cerrado" };

export default function Tasks() {
  const [filterProject, setFilterProject] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterCompleted, setFilterCompleted] = useState("false");
  const [sort, setSort] = useState<"priority" | "due_date">("priority");
  const [view, setView] = useState<"list" | "board">("list");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [taskModal, setTaskModal] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState(false);
  const [editProject, setEditProject] = useState<ApiProject | null>(null);
  // lo anterior a 90 días se pide a mano: es una ruta poco frecuente
  const [olderOpen, setOlderOpen] = useState(false);

  const { query, queue, tasks, pendingIds } = useTasks();
  const { projects } = useProjects();
  const history = useTaskHistory(olderOpen);
  const unsynced = queue.filter((e) => e.status === "pending").length;
  const rejected = queue.filter((e) => e.status === "error");

  // el formulario y la hoja siguen a la vista derivada: mover o marcar se ve sin cerrarlos
  const known = useMemo(() => [...tasks, ...history.tasks], [tasks, history.tasks]);
  const editTask = known.find((t) => t.id === editTaskId) ?? null;
  const moving = tasks.find((t) => t.id === movingId) ?? null;
  const allTags = useMemo(() => [...new Set(known.flatMap((t) => parseTags(t.tags)))].sort(), [known]);

  const matches = (t: ApiTask) =>
    (!filterProject || t.project_id === filterProject) &&
    (!filterPriority || t.priority === filterPriority) &&
    (!filterTag || parseTags(t.tags).includes(filterTag));
  const onBoard = tasks.filter(matches);
  const wantsDone = filterCompleted !== "false";
  const activeFilters = [filterProject, filterPriority, filterTag, wantsDone && view === "list"].filter(Boolean).length;
  const listed = sortTasks(onBoard.filter((t) => filterCompleted === "" || t.completed === (filterCompleted === "true")), sort);
  const older = wantsDone && olderOpen ? history.tasks.filter(matches) : [];

  const move = (t: ApiTask, status: ApiTask["status"], prev: string | null, next: string | null) =>
    taskActions.move(t, status, prev, next);

  const remove = async (t: ApiTask) => {
    if (!(await confirm({ message: `¿Eliminar la tarea «${t.title}»?`, danger: true }))) return;
    taskActions.remove(t);
    setTaskModal(false);
  };
  const removeProject = async (p: ApiProject) => {
    if (!(await confirm({ message: `¿Eliminar el proyecto «${p.name}»? Sus tareas quedarán sin proyecto.`, danger: true }))) return;
    projectActions.remove(p);
  };
  const openNewTask = () => { setEditTaskId(null); setTaskModal(true); };
  const openEditTask = (t: ApiTask) => { setEditTaskId(t.id); setTaskModal(true); };
  const openNewProject = () => { setEditProject(null); setProjectModal(true); };
  const openEditProject = (p: ApiProject) => { setEditProject(p); setProjectModal(true); };

  const projColor = (id: string | null) => projects.find((p) => p.id === id)?.color;

  // La línea de contexto de la cabecera. Cuenta sobre `projects`, que llega sin
  // filtrar, y no sobre lo filtrado: si no, elegir un proyecto en el filtro haría
  // que la cabecera dijera que sólo queda ese.
  const pending = projects.reduce((s, p) => s + p.tasks_pending, 0);
  /* Vencido y «vence esta semana» son dos estados, no uno.
   *
   * La cuenta era `due_date <= hoy+7`, así que se tragaba también todo lo que ya
   * había pasado de plazo: con once tareas vencidas y siete próximas, la
   * cabecera decía «17 vencen esta semana» y lo urgente —lo que ya se pasó—
   * desaparecía dentro de lo simplemente próximo. La banda de vencimientos
   * tampoco las pinta: empieza en hoy. */
  const hoy = isoDate(new Date());
  const enUnaSemana = isoDate(new Date(Date.now() + 7 * 864e5));
  const conPlazo = onBoard.filter((t) => !t.completed && t.due_date);
  const vencidas = conPlazo.filter((t) => t.due_date! < hoy).length;
  const dueSoon = conPlazo.filter((t) => t.due_date! >= hoy && t.due_date! <= enUnaSemana).length;
  const headerContext =
    `${pending} pendientes en ${projects.length} proyecto${projects.length === 1 ? "" : "s"}` +
    (vencidas > 0 ? ` · ${vencidas} vencida${vencidas === 1 ? "" : "s"}` : "") +
    (dueSoon > 0 ? ` · ${dueSoon} vence${dueSoon === 1 ? "" : "n"} esta semana` : "") +
    (unsynced > 0 ? ` · ${unsynced} sin sincronizar` : "");

  return (
    /* En teléfono la rúbrica va antes que los proyectos (DESIGN_SYSTEM): con diez
       proyectos en una columna, las tareas quedaban a varias pantallas. */
    <div className="flex flex-col gap-3">
      <PageHeader title="Tareas y Proyectos" context={headerContext}>
        <Segmented label="Vista" size="sm" value={view} onChange={setView} options={[
          { value: "list", label: <IconList size={15} />, title: "Lista" },
          { value: "board", label: <IconLayoutKanban size={15} />, title: "Tablero" },
        ]} />
        {/* En teléfono, una sola fila y los filtros plegados: le robaban la pantalla a la lista. */}
        <button className="btn lg:hidden" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} aria-label="Filtros" title="Filtros"
          style={filtersOpen || activeFilters > 0 ? { borderColor: "var(--gr-edge-focus)", color: "var(--gr-arcane)" } : undefined}>
          <IconFilter size={14} />
        </button>
        <button className="btn" onClick={openNewProject} aria-label="Nuevo proyecto" title="Nuevo proyecto"><IconFolder size={14} /> <span className="hidden lg:inline">Proyecto</span></button>
        <button className="btn btn-primary" onClick={openNewTask}><IconPlus size={14} /> Tarea</button>
      </PageHeader>

      {/* Un rechazo no se pierde con el toast: queda aquí hasta que se lea. */}
      {rejected.map((e) => (
        <Card key={e.id}>
          <p className="gr-sangrado text-sm text-[var(--text-body)]">No se sincronizó: {e.request.label}</p>
          <p className="gr-sangrado mt-1 text-xs text-[var(--gr-oxblood)]">{e.message}</p>
          <button className="btn mt-2" onClick={() => dismissQueueEntry(e.id)}>Descartar</button>
        </Card>
      ))}

      {/* Projects */}
      <div className="order-last grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:order-none lg:grid-cols-4">
        {projects.map((p) => (
          <div key={p.id} className="card flex items-start gap-3" style={{ borderLeft: `2px solid ${p.color}` }}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-5 lg:gap-1">
                <span className="mr-auto truncate font-display text-sm text-[var(--text-primary)]">{p.name}</span>
                <button className="gr-tactil text-[var(--text-faint)] hover:text-[var(--purple-main)]" title="Editar" aria-label={`Editar ${p.name}`} onClick={() => openEditProject(p)}>
                  <IconEdit size={12} />
                </button>
                <button className="gr-tactil text-[var(--text-faint)] hover:text-[var(--gr-oxblood)]" title="Eliminar" aria-label={`Eliminar ${p.name}`} onClick={() => removeProject(p)}>
                  <IconTrash size={12} />
                </button>
              </div>
              <div className="mt-1 font-label text-2xs text-[var(--text-muted)]">
                {STATUS_LABEL[p.status]} · {p.category ?? "—"}
              </div>
              <div className="mt-2.5 flex justify-between text-xs tabular text-[var(--text-body)]">
                {/* La cifra son las HECHAS, que es lo que cuenta la rueda de al
                    lado. Decía «pend.», así que un proyecto con las cinco tareas
                    por hacer anunciaba «0/5 pend.» — se leía como que no queda
                    nada pendiente, justo lo contrario. */}
                <span>{p.tasks_total - p.tasks_pending}/{p.tasks_total} hechas</span>
              </div>
            </div>
            {/* La rueda cuenta las tareas cerradas del proyecto. Al lado del
                «7/12» dice lo mismo, pero se lee sin leer. */}
            <ProgressSigil done={p.tasks_total - p.tasks_pending} total={p.tasks_total} />
          </div>
        ))}
      </div>

      {/* Filters */}
      <Card className={filtersOpen ? "" : "hidden lg:block"}>
        <div className="gr-sangrado grid grid-cols-2 items-center gap-2 text-xs lg:flex lg:flex-wrap">
          <select className="input lg:w-auto" aria-label="Proyecto" value={filterProject} onChange={(e) => setFilterProject(e.target.value)}>
            <option value="">Todos los proyectos</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input lg:w-auto" aria-label="Prioridad" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
            <option value="">Toda prioridad</option>
            <option value="high">Alta</option>
            <option value="medium">Media</option>
            <option value="low">Baja</option>
          </select>
          {/* El tablero trae todos los estados y su propio orden: aquí no harían nada. */}
          {view === "list" && (
            <>
              <select className="input lg:w-auto" aria-label="Estado" value={filterCompleted} onChange={(e) => setFilterCompleted(e.target.value)}>
                <option value="false">Pendientes</option>
                <option value="true">Completadas</option>
                <option value="">Todas</option>
              </select>
              <select className="input lg:w-auto" aria-label="Orden" value={sort} onChange={(e) => setSort(e.target.value as "priority" | "due_date")}>
                <option value="priority">Por prioridad</option>
                <option value="due_date">Por fecha límite</option>
              </select>
            </>
          )}
          <div className="col-span-2 lg:ml-auto"><TagFilterBar tags={allTags} active={filterTag} onSelect={setFilterTag} /></div>
        </div>
      </Card>

      {/* La rúbrica va antes que la banda: el tablero es a lo que se viene, y
          los vencimientos son el contexto con el que se cierra la vista.
          Al revés, lo primero que se leía era un calendario de plazos —lo que
          aprieta— en vez del trabajo. */}
      <Card rank="rubric" title={view === "board" ? "Tablero" : "Tareas"} right={view === "board" ? (
        <span className="hidden normal-case tracking-normal text-xs italic text-[var(--text-faint)] lg:inline">
          arrastra entre columnas; cruzar a Hecho concede el XP
        </span>
      ) : undefined}>
        {query.isPending && query.fetchStatus === "paused" && (
          <p className="text-xs text-[var(--text-muted)]">Sin conexión. Las tareas se cargan cuando vuelva la señal.</p>
        )}
        {query.isPending && query.fetchStatus !== "paused" && (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
        )}
        {query.isError && !query.data && (
          <>
            <p className="text-xs text-[var(--text-muted)]">No se pudieron cargar las tareas.</p>
            <button className="btn mt-2" onClick={() => query.refetch()}>Reintentar</button>
          </>
        )}
        {(query.data || tasks.length > 0) && (view === "board" ? (
          <KanbanBoard tasks={onBoard} pendingIds={pendingIds} projectColor={projColor} onReorder={move} onEdit={openEditTask} onMove={(t) => setMovingId(t.id)} />
        ) : (
          <div className="space-y-2">
            {listed.length === 0 && older.length === 0 && <p className="text-xs text-[var(--text-muted)]">Sin tareas.</p>}
            {listed.map((t) => (
              <TaskCard key={t.id} task={t} pending={pendingIds.has(t.id)} projectColor={projColor(t.project_id)}
                onComplete={taskActions.complete} onUncomplete={taskActions.uncomplete} onEdit={openEditTask} onDelete={remove} />
            ))}
            {older.map((t) => (
              <TaskCard key={t.id} task={t} projectColor={projColor(t.project_id)}
                onComplete={taskActions.complete} onUncomplete={taskActions.uncompleteOlder} onEdit={openEditTask} onDelete={remove} />
            ))}
            {wantsDone && (!olderOpen || history.query.hasNextPage) && (
              <button className="btn" disabled={history.query.isFetching}
                onClick={() => (olderOpen ? history.query.fetchNextPage() : setOlderOpen(true))}>
                {history.query.isFetching ? "Cargando…" : "Completadas más antiguas"}
              </button>
            )}
          </div>
        ))}
      </Card>

      {/* Sin el filtro de estado: lo que aprieta no deja de apretar por mirar las completadas. */}
      <DueBand tasks={onBoard} projectColor={projColor} />

      {taskModal && <TaskForm task={editTask} tasks={tasks} projects={projects} onDelete={remove} onClose={() => setTaskModal(false)} />}
      {projectModal && <ProjectForm project={editProject} onClose={() => setProjectModal(false)} />}
      {moving && <MoveSheet task={moving} tasks={tasks} visible={onBoard} onClose={() => setMovingId(null)} />}
    </div>
  );
}

/**
 * Mover sin arrastre (decisión 9): el dedo no puede arrastrar en HTML5, y un tablero con
 * scroll tampoco lo agradecería. Cambiar de columna deja la tarjeta al final de la otra, y subir o
 * bajar la mueve un puesto. La hoja sigue abierta para poder repetir.
 */
function MoveSheet({ task, tasks, visible, onClose }: {
  /** `tasks`: todas, para llegar de verdad al final. `visible`: lo que se ve, para subir y bajar. */
  task: ApiTask; tasks: ApiTask[]; visible: ApiTask[]; onClose: () => void;
}) {
  const column = visible.filter((t) => t.status === task.status);
  const lastOf = (status: ApiTask["status"]) => tasks.filter((t) => t.status === status).at(-1)?.rank ?? null;
  const position = column.findIndex((t) => t.id === task.id);
  const up = stepNeighbours(column, task.id, -1);
  const down = stepNeighbours(column, task.id, 1);
  const step = (n: [string | null, string | null] | null) => {
    if (n) taskActions.move(task, task.status, n[0], n[1]);
  };
  return (
    <Modal title={`Mover «${task.title}»`} onClose={onClose}>
      {/* Sin `Field`: es un <label>, y tocar el rótulo activaría el primer botón. */}
      <div className="mb-3">
        <span className="mb-1 block font-label text-xs text-[var(--text-muted)]">Columna</span>
        <div className="grid grid-cols-3 gap-2">
          {COLUMNS.map((c) => (
            <button key={c.key} type="button" aria-pressed={c.key === task.status}
              className={`btn justify-center ${c.key === task.status ? "btn-primary" : ""}`}
              onClick={() => { if (c.key !== task.status) taskActions.move(task, c.key, lastOf(c.key), null); }}>
              {c.key === task.status && <IconCheck size={13} />}{c.label}
            </button>
          ))}
        </div>
      </div>
      {!task.completed && <p className="mb-3 text-xs italic text-[var(--text-muted)]">Pasar a Hecho concede {task.xp_reward} XP.</p>}
      <div className="mb-3">
        <span className="mb-1 block font-label text-xs text-[var(--text-muted)]">Orden · <span className="tabular">{position + 1} de {column.length}</span></span>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn justify-center" disabled={!up} onClick={() => step(up)}><IconArrowUp size={14} /> Subir</button>
          <button type="button" className="btn justify-center" disabled={!down} onClick={() => step(down)}><IconArrowDown size={14} /> Bajar</button>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

/* La banda de vencimientos: veintiún días desde hoy, en línea.
 *
 * La lista ordenada por fecha ya dice qué vence antes; lo que no dice es si
 * vencen repartidos o los cinco el mismo jueves. Eso sólo se ve en una recta.
 *
 * Se calla si no hay nada en el horizonte: una banda vacía con su rótulo
 * ocupa el mismo sitio que una llena y no informa de nada. */
const DUE_DAYS = 21;

function DueBand({ tasks, projectColor }: {
  tasks: ApiTask[];
  projectColor: (id: string | null) => string | undefined;
}) {
  // lo que en la v1 decía el `title` al pasar el ratón: en táctil, al tocar la marca
  const [openDay, setOpenDay] = useState<number | null>(null);
  const desktop = useIsDesktop();
  const today = new Date(isoDate(new Date()) + "T00:00");
  const due = tasks
    .filter((t) => !t.completed && t.due_date)
    .map((t) => ({
      task: t,
      day: Math.round((new Date(t.due_date! + "T00:00").getTime() - today.getTime()) / 864e5),
    }))
    .filter((m) => m.day >= 0 && m.day <= DUE_DAYS);

  /* Una marca por día, no por tarea.
   *
   * Con una por tarea, los diecisiete vencimientos reales de este mes salían
   * apilados: cinco rótulos en la misma abscisa, superpuestos e ilegibles, y el
   * único caso donde la banda sirve de algo —varias cosas el mismo día— era
   * justo el que no se podía leer. Agrupadas, el día dice cuántas caen y el
   * `title` las nombra. */
  const marks = Object.values(
    due.reduce<Record<number, { day: number; items: ApiTask[] }>>((acc, m) => {
      (acc[m.day] ??= { day: m.day, items: [] }).items.push(m.task);
      return acc;
    }, {}),
  ).sort((a, b) => a.day - b.day);

  if (marks.length === 0) return null;
  const opened = marks.find((m) => m.day === openDay);

  return (
    <Card>
      {/* La única cadena de Tareas: la banda es la sección que ordena la vista
          en el tiempo, y el tablero —que es la rúbrica— manda por su nudo. */}
      <div className="gr-sangrado">
        <SectionBand sigil="reloj" label={`Los vencimientos · próximos ${DUE_DAYS} días`}
                     count={marks.length} fill="cadena" />
      </div>
      <div className="relative ml-7 mr-1 mt-3 h-[76px]">
        <div
          className="absolute inset-x-0 top-11 h-px"
          style={{ background: "repeating-linear-gradient(to right, var(--gr-edge) 0 2px, transparent 2px 7px)" }}
        />
        {Array.from({ length: DUE_DAYS + 1 }, (_, i) => {
          const d = new Date(today.getTime() + i * 864e5);
          const major = i === 0 || d.getDate() % 5 === 0;
          return (
            <span key={i} className="absolute" style={{ left: `${(i / DUE_DAYS) * 100}%` }}>
              <span
                className="absolute top-11 block w-px bg-[var(--gr-edge)]"
                style={{ height: major ? 7 : 4 }}
              />
              {major && (
                <span className="absolute top-[54px] block -translate-x-1/2 text-2xs tabular text-[var(--text-faint)]">
                  {d.getDate()}
                </span>
              )}
            </span>
          );
        })}
        {marks.map((m, i) => {
          /* La etiqueta crece hacia la derecha desde su día, y la recta llega
             hasta el borde de la card: cualquier vencimiento del último tramo
             sacaba su caja de 120px fuera de la ventana y ponía scroll
             horizontal a la vista entera. Pasado el 80% se ancla al otro lado.
             El conector no se mueve: sigue clavado en el día. En teléfono la
             recta es corta: etiquetas más angostas, que al tocarlas dicen el resto. */
          const pct = (m.day / DUE_DAYS) * 100;
          const alFinal = pct > (desktop ? 80 : 70);
          return (
            <span
              key={m.day}
              /* Ancho cero: la marca es un punto en la recta, no una caja. Con
                 la etiqueta en flujo, el ancho de ésta se sumaba al del padre y
                 la vista entera acababa con scroll horizontal aunque el rótulo
                 ya estuviera volteado. */
              className="absolute w-0"
              style={{ left: `${pct}%`, top: i % 2 ? 22 : 2 }}
              title={m.items.map((t) => t.title).join("\n")}
            >
              <span
                className="absolute left-0 top-4 block w-px bg-[var(--gr-edge-strong)]"
                style={{ height: i % 2 ? 22 : 42 }}
              />
              <button
                type="button"
                onClick={() => setOpenDay(openDay === m.day ? null : m.day)}
                aria-label={`${m.items.length} vencen el día ${m.day}: ${m.items.map((t) => t.title).join(", ")}`}
                className={`absolute top-0 flex w-max max-w-[72px] items-center lg:max-w-[120px] gap-1 rounded-sm bg-[var(--bg-elevated)] px-1.5 py-0.5 text-2xs text-[var(--text-body)] ${
                  alFinal ? "right-0 border-r-2" : "left-0 border-l-2"
                }`}
                style={{
                  [alFinal ? "borderRightColor" : "borderLeftColor"]:
                    projectColor(m.items[0].project_id) ?? "var(--border-accent)",
                }}
              >
                <span className="truncate">{m.items[0].title}</span>
                {m.items.length > 1 && (
                  <span className="shrink-0 tabular text-[var(--text-faint)]">+{m.items.length - 1}</span>
                )}
              </button>
            </span>
          );
        })}
      </div>
      {opened && (
        <ul className="ml-7 mt-2 space-y-0.5 text-xs text-[var(--text-body)]">
          {opened.items.map((t) => <li key={t.id} className="truncate">{t.due_date} · {t.title}</li>)}
        </ul>
      )}
      {/* La prioridad es dato, no acento: tres colores semánticos y ningún oro.
          Un vencimiento cercano no es una recompensa. */}
      <div className="ml-7 mt-2 flex flex-wrap items-center gap-4 font-label text-2xs text-[var(--text-faint)]">
        {([["Alta", "var(--gr-oxblood)"], ["Media", "var(--gr-amber)"], ["Baja", "var(--gr-ink-dim)"]] as const).map(
          ([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{l}
            </span>
          ),
        )}
        <span className="ml-auto hidden font-normal normal-case italic tracking-normal lg:inline">
          la prioridad es dato, no acento: el oro no entra aquí
        </span>
      </div>
    </Card>
  );
}

function TaskForm({ task, tasks, projects, onDelete, onClose }: {
  task: ApiTask | null; tasks: ApiTask[]; projects: ApiProject[]; onDelete: (t: ApiTask) => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [category, setCategory] = useState(task?.category ?? "");
  const [priority, setPriority] = useState<ApiTask["priority"]>(task?.priority ?? "medium");
  const [projectId, setProjectId] = useState(task?.project_id ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [remindAt, setRemindAt] = useState(remindAtToLocal(task?.remind_at ?? null));
  const [tags, setTags] = useState(task?.tags ?? "");
  const [xp, setXp] = useState(task?.xp_reward ?? 15);

  const save = () => {
    if (!title.trim()) return;
    const payload = {
      title, description: description || null, category: category || null, priority,
      project_id: projectId || null, due_date: dueDate || null,
      remind_at: remindAtToUtc(remindAt), tags: tags || null, xp_reward: xp,
    };
    if (task) taskActions.update(task, payload);
    else taskActions.create(payload, rankAtEnd(tasks, "todo"));
    onClose();
  };

  return (
    <Modal title={task ? "Editar tarea" : "Nueva tarea"} onClose={onClose}>
      <Field label="Título"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Descripción"><textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Proyecto">
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Ninguno</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Prioridad">
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as ApiTask["priority"])}>
            <option value="high">Alta</option>
            <option value="medium">Media</option>
            <option value="low">Baja</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Fecha límite"><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        <Field label="Recordatorio"><input type="datetime-local" className="input" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} /></Field>
      </div>
      <Field label="Categoría"><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
      <Field label="Etiquetas"><TagInput value={tags} onChange={setTags} /></Field>
      <Field label={`XP por completar (${xp})`}>
        <input type="range" min={5} max={50} step={5} value={xp} onChange={(e) => setXp(Number(e.target.value))} className="w-full" />
      </Field>
      {task && <ChecklistEditor task={task} />}
      <div className="mt-2 flex items-center justify-end gap-2">
        {task && <button className="btn mr-auto" onClick={() => onDelete(task)}><IconTrash size={13} /> Eliminar</button>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

function ChecklistEditor({ task }: { task: ApiTask }) {
  const [draft, setDraft] = useState("");
  const items = task.checklist;

  const add = () => {
    if (!draft.trim()) return;
    taskActions.addItem(task.id, draft.trim());
    setDraft("");
  };
  const toggle = (it: ApiChecklistItem) => taskActions.updateItem(it, { done: !it.done });

  // no un `Field`: es un <label>, y tocar una fila activaría su primer botón
  return (
    <div className="mb-3">
      <span className="mb-1 block font-label text-xs text-[var(--text-muted)]">Subtareas (<span className="tabular">{task.checklist_done}/{task.checklist_total}</span>)</span>
      <div className="space-y-3 lg:space-y-1">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-4 text-xs lg:gap-2">
            <button onClick={() => toggle(it)} aria-pressed={it.done} aria-label={`${it.done ? "Desmarcar" : "Marcar"} ${it.text}`} className="gr-tactil text-[var(--purple-main)]">
              <IconChecklist size={14} className={it.done ? "opacity-100" : "opacity-40"} />
            </button>
            <span className={`min-w-0 flex-1 break-words ${it.done ? "text-[var(--text-faint)] line-through" : "text-[var(--text-body)]"}`}>{it.text}</span>
            <button onClick={() => taskActions.removeItem(it)} aria-label={`Borrar ${it.text}`} className="gr-tactil text-[var(--text-faint)] hover:text-[var(--gr-oxblood)]"><IconTrash size={12} /></button>
          </div>
        ))}
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Añadir subtarea…" aria-label="Añadir subtarea" value={draft}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <button className="btn" onClick={add} aria-label="Agregar subtarea"><IconPlus size={13} /></button>
        </div>
      </div>
    </div>
  );
}

function ProjectForm({ project, onClose }: { project: ApiProject | null; onClose: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState(project?.status ?? "active");
  const [category, setCategory] = useState(project?.category ?? "Académico");
  const [color, setColor] = useState(project?.color ?? CATEGORY_COLORS["Académico"]);

  const save = () => {
    if (!name.trim()) return;
    const payload = { name, description: description || null, status, category, color };
    if (project) projectActions.update(project, payload);
    else projectActions.create(payload);
    onClose();
  };

  return (
    <Modal title={project ? "Editar proyecto" : "Nuevo proyecto"} onClose={onClose}>
      <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Descripción"><textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Estado">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Activo</option>
            <option value="paused">Pausado</option>
            <option value="closed">Cerrado</option>
          </select>
        </Field>
        <Field label="Categoría">
          <select className="input" value={category} onChange={(e) => { setCategory(e.target.value); setColor(CATEGORY_COLORS[e.target.value] ?? color); }}>
            {PROJECT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Color"><input type="color" className="input h-9 p-1" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}
