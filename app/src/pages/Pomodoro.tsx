import { useState } from "react";
import { IconClock, IconHistory, IconSettings } from "@tabler/icons-react";
import { Card } from "../components/ui/Card";
import { SectionBand } from "../components/ui/SectionBand";
import { Skeleton } from "../components/ui/Skeleton";
import { PageHeader } from "../components/layout/PageHeader";
import { PomodoroTimer, PomodoroCycle } from "../components/ui/PomodoroTimer";
import { AUTOSTART_HINT, ReminderAccessNotice } from "../components/ui/ReminderAccessNotice";
import { usePomodoroCtx } from "../pomodoro-context";
import { usePomodoroToday } from "../api/pomodoro";
import { useProjects } from "../api/projects";
import { useTasks } from "../api/tasks";
import { isNative } from "../notify";
import { useIsDesktop } from "../hooks/useMediaQuery";
import type { ApiPomodoroSession } from "../types";

// La UI muestra la hora de Bogotá, sin importar la zona del dispositivo (como en Tareas). Colombia
// no tiene horario de verano: el desfase es fijo.
const BOGOTA_MS = 5 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
function clock(ms: number) {
  const d = new Date(ms - BOGOTA_MS);
  return { hours: d.getUTCHours() + d.getUTCMinutes() / 60, text: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}
const at = (iso: string) => clock(Date.parse(iso));

export default function Pomodoro() {
  const pomo = usePomodoroCtx();
  const { tasks: allTasks } = useTasks();
  const { projects } = useProjects();
  const today = usePomodoroToday(allTasks);
  const desktop = useIsDesktop();

  // Hasta restaurar de disco no hay temporizador que mostrar: uno de 25:00 sería falso.
  if (!pomo) {
    return (
      <div className="space-y-3">
        <PageHeader title="Pomodoro" />
        <Skeleton className="h-[360px] rounded-lg" />
      </div>
    );
  }

  const { config, setConfig, tasks, links, setTaskId, setProjectId, activeTask, notice } = pomo;
  const { sessions, totalMinutes, pendingIds } = today;
  // Las abandonadas se cuentan aparte: no puntúan, pero ocultarlas de la cabecera haría que el día
  // pareciera más limpio de lo que fue.
  const done = sessions.filter((s) => s.completed).length;
  const abandoned = sessions.length - done;
  // Heredado es una procedencia, no un candado: deja de serlo en cuanto se cambia.
  const inheritedProject = activeTask?.project_id != null && links.projectId === activeTask.project_id;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Pomodoro"
        context={
          (sessions.length === 0
            ? "Sin sesiones aún hoy"
            : `${done} ${done === 1 ? "sesión" : "sesiones"} · ${totalMinutes} min de foco` +
              (abandoned > 0 ? ` · ${abandoned} abandonada${abandoned === 1 ? "" : "s"}` : "")) +
          (pendingIds.size > 0 ? ` · ${pendingIds.size} sin sincronizar` : "")
        }
      >
        <PomodoroCycle done={pomo.cycleDone} />
      </PageHeader>

      <ReminderAccessNotice subject="Los avisos del pomodoro" />
      {/* El temporizador nunca depende del aviso (decisión 1): corre igual, y la vista lo dice. */}
      {(notice === "denied" || notice === "failed") && (
        <Card>
          <p className="gr-sangrado text-xs text-[var(--text-body)]">
            El temporizador corre, pero no sonará con la app cerrada:{" "}
            {notice === "denied" ? "faltan permisos de notificación." : "no se pudo agendar el aviso."}
          </p>
        </Card>
      )}

      {/* Reloj a la izquierda, ajustes y log a la derecha en `lg:` (v1). En teléfono, apilados y el
          reloj primero: es la rúbrica. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-[1.6]">
          <Card rank="rubric">
            <div className="gr-sangrado py-2">
              <PomodoroTimer
                phase={pomo.phase}
                secondsLeft={pomo.secondsLeft}
                totalSeconds={pomo.totalSeconds}
                running={pomo.running}
                progress={pomo.progress}
                subtitle={activeTask?.title}
                onStart={pomo.start}
                onPause={pomo.pause}
                onReset={pomo.reset}
                onSkip={pomo.skip}
                side={
                  <>
                    <label className="block">
                      <span className="mb-1.5 block font-label text-xs text-[var(--text-muted)]">Tarea vinculada</span>
                      <select className="input bg-[var(--gr-surface-sunken)]" value={links.taskId ?? ""} onChange={(e) => setTaskId(e.target.value || null)}>
                        <option value="">Sin vincular</option>
                        {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block font-label text-xs text-[var(--text-muted)]">
                        Proyecto {inheritedProject && <span className="text-[var(--purple-main)]">· heredado de la tarea</span>}
                      </span>
                      <select className="input bg-[var(--gr-surface-sunken)]" value={links.projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)}>
                        <option value="">Sin proyecto</option>
                        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                    {isNative() && <p className="text-xs italic text-[var(--text-muted)]">{AUTOSTART_HINT}</p>}
                  </>
                }
              />
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Card title="Configuración" icon={<IconSettings size={14} />}>
            <ConfigRow label="Trabajo" value={config.work} onChange={(v) => setConfig({ ...config, work: v })} />
            <ConfigRow label="Descanso corto" value={config.short} onChange={(v) => setConfig({ ...config, short: v })} />
            <ConfigRow label="Descanso largo" value={config.long} onChange={(v) => setConfig({ ...config, long: v })} />
            <p className="mt-2.5 text-xs italic text-[var(--text-faint)]">
              El descanso largo entra cada cuatro pomodoros del ciclo. Un bloque ya empezado conserva su duración.
            </p>
          </Card>

          <Card title="Log del día" icon={<IconHistory size={14} />} right={<span className="font-label text-xs text-[var(--purple-main)]">{totalMinutes} min foco</span>}>
            {sessions.length === 0 && <p className="text-sm text-[var(--text-muted)]">Sin sesiones aún.</p>}
            {/* Las abandonadas se registran para que las horas cuadren, pero no puntúan: se leen
                como lo que son, en tinta tenue y sin acento. */}
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 border-b border-[var(--gr-edge)] py-1.5 text-xs last:border-none ${
                  s.completed ? "text-[var(--text-body)]" : "text-[var(--text-faint)]"
                }`}
              >
                <span className="tabular text-[var(--text-muted)]">{at(s.started_at).text}</span>
                <span className="min-w-0 truncate">{s.task_title ?? "Sesión libre"}</span>
                {!s.completed && <span className="shrink-0 italic">abandonada</span>}
                {pendingIds.has(s.id) && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-[var(--text-muted)]"><IconClock size={11} /> pendiente</span>
                )}
                <span className={`ml-auto shrink-0 tabular ${s.completed ? "text-[var(--purple-main)]" : ""}`}>
                  {s.work_minutes}m
                </span>
              </div>
            ))}
          </Card>
        </div>
      </div>

      {/* La jornada cierra la vista a lo ancho: las sesiones del día sobre la recta de 18 horas. El
          log ya las lista en orden, pero en lista no se ve el hueco de las once a las cuatro, y ese
          hueco es lo que se quiere ver. */}
      <Card rank="pozo">
        {/* En teléfono el rótulo partía en dos líneas y la cifra en «30 / MIN»: el eje ya dice las horas. */}
        <SectionBand versal="L" label={desktop ? "a jornada · 06:00 → 24:00" : "a jornada"} fill="filete" count={`${totalMinutes} min`}>
          <DayLine sessions={sessions} />
        </SectionBand>
      </Card>
    </div>
  );
}

/* La recta del día, de las 06:00 a medianoche.
 *
 * Una sesión completada es un bloque de arcano macizo; una abandonada, el mismo bloque en
 * discontinuo y vacío: se registran para que las horas cuadren, pero no puntúan.
 *
 * El filo de oro marca la hora actual. Es el único oro de la pieza y no premia nada: sitúa.
 *
 * En la v1 cada bloque decía lo suyo en un `title`, que en táctil no existe. Aquí tocar un bloque
 * dice debajo de la recta lo que hay alrededor; el `title` se queda para el ratón. En teléfono la
 * hora mide ~15 px y el área táctil 44 px, así que dos pomodoros seguidos comparten zona y un toque
 * no puede elegir uno solo: se listan las sesiones a ±1,5 h del bloque tocado, el radio del área. */
const H0 = 6;
const H1 = 24;
const SPAN = H1 - H0;

const NEAR_H = 1.5;

// El título al final: en teléfono es lo que se corta, y la hora y los minutos son lo que se busca.
const describe = (s: ApiPomodoroSession) =>
  `${at(s.started_at).text} · ${s.work_minutes}m${s.completed ? "" : " (abandonada)"} · ${s.task_title ?? "Sesión libre"}`;

function DayLine({ sessions }: { sessions: ApiPomodoroSession[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const now = clock(Date.now()).hours;
  const pct = (h: number) => ((h - H0) / SPAN) * 100;
  const center = sessions.find((s) => s.id === picked);
  const near = center
    ? sessions
        .filter((s) => Math.abs(at(s.started_at).hours - at(center.started_at).hours) <= NEAR_H)
        .sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
    : [];

  return (
    <div>
      <div className="relative h-16">
        <div className="absolute inset-x-0 top-[30px] h-px bg-[var(--gr-edge)]" />
        {Array.from({ length: SPAN + 1 }, (_, i) => H0 + i).map((h) => {
          const major = h % 3 === 0;
          return (
            <span key={h}>
              <span className="absolute w-px" style={{
                left: `${pct(h)}%`, top: major ? 24 : 27,
                height: major ? 13 : 7,
                background: major ? "var(--border-strong)" : "var(--gr-edge)",
              }} />
              {major && (
                <span className="absolute -translate-x-1/2 tabular text-2xs text-[var(--text-faint)]"
                      style={{ left: `${pct(h)}%`, top: 44 }}>
                  {pad(h)}
                </span>
              )}
            </span>
          );
        })}
        {sessions.map((s) => {
          const h = at(s.started_at).hours;
          if (h < H0) return null;
          return (
            <button
              key={s.id}
              type="button"
              title={describe(s)}
              aria-label={describe(s)}
              aria-pressed={picked === s.id}
              onClick={() => setPicked((cur) => (cur === s.id ? null : s.id))}
              // `!absolute`: en táctil, `.gr-tactil` fija `position: relative` fuera de capa y le ganaba a
              // `absolute`; los bloques quedaban en el flujo, corridos 2 px por cada uno anterior.
              className="gr-tactil !absolute top-[22px] h-[17px] rounded-xs"
              style={{
                left: `${pct(h)}%`,
                width: `${(s.work_minutes / 60 / SPAN) * 100}%`,
                background: s.completed ? "var(--gr-arcane)" : "transparent",
                border: s.completed
                  ? "1px solid var(--gr-arcane-bright)"
                  : "1px dashed var(--border-strong)",
                outline: picked === s.id ? "1px solid var(--gr-edge-focus)" : undefined,
              }}
            />
          );
        })}
        {now >= H0 && now <= H1 && (
          <span className="pointer-events-none absolute top-[18px] h-6 w-px bg-[var(--gr-gilded)]"
                style={{ left: `${pct(now)}%` }} title="Ahora" />
        )}
      </div>
      {near.map((s) => <p key={s.id} className="mt-1 truncate text-xs text-[var(--text-body)]">{describe(s)}</p>)}
      <div className="mt-1.5 flex flex-wrap items-center gap-4 font-label text-2xs text-[var(--text-faint)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-xs bg-[var(--gr-arcane)]" />foco completado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-xs border border-dashed border-[var(--border-strong)]" />abandonada
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-px bg-[var(--gr-gilded)]" />ahora
        </span>
      </div>
    </div>
  );
}

function ConfigRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-body)]">
      <span className="flex-1">{label}</span>
      <input
        type="number" min={1} max={90} value={value} aria-label={`${label}, minutos`}
        /* El mismo techo que aplica `restoreConfig` y que acepta la API. Sin él se podían teclear
           500 minutos y al reabrir volvían 90: la configuración cambiaba sola. */
        onChange={(e) => onChange(Math.min(90, Math.max(1, Math.trunc(Number(e.target.value)) || 1)))}
        className="input w-16 text-center"
      />
      <span className="text-[var(--text-muted)]">min</span>
    </div>
  );
}
