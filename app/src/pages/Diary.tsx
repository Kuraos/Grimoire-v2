import { useEffect, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconEye, IconPencil, IconSearch } from "@tabler/icons-react";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/layout/PageHeader";
import { DiaryVolume } from "../components/charts/DiaryVolume";
import { MiniCalendar } from "../components/ui/MiniCalendar";
import { TagInput } from "../components/ui/TagInput";
import { useDiaryEditor, useDiarySearch, useDiaryVolume, type DiaryStatus } from "../api/diary";
import { localDate } from "../api/habits";
import { MONTHS_ES, renderMarkdown } from "../utils";
import type { DaySummary, DiaryConflict } from "../types";

const STATUS: Record<DiaryStatus, string> = {
  loading: "Cargando…",
  editing: "Cambios sin guardar…",
  queued: "Guardado en el dispositivo · sin sincronizar",
  saved: "Guardado",
};

/** El día anterior o siguiente, en el calendario y sin pasar por la zona del dispositivo. */
function shift(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default function Diary() {
  const [day, setDay] = useState(() => localDate(new Date()));
  const editor = useDiaryEditor(day);
  const volume = useDiaryVolume();
  const [preview, setPreview] = useState(false);

  // el editor guarda el día que se deja al cambiar `day` (fase-2-diario.md, decisión 2)
  const goTo = (d: string) => setDay(d);

  const words = editor.content.trim() ? editor.content.trim().split(/\s+/).length : 0;
  const marks: Record<string, string[]> = {};
  for (const p of volume.points) marks[p.local_date] = ["var(--gr-arcane)"];
  const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1];

  return (
    /* 1.9 : 1 en `lg:`, como la v1. En teléfono, una columna con la entrada primero: es la rúbrica. */
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.9fr_1fr]">
      <PageHeader
        title="Diario"
        className="lg:col-span-2"
        context={`${words} palabra${words === 1 ? "" : "s"} · ${volume.total} entrada${volume.total === 1 ? "" : "s"} en el volumen`}
      >
        <button className="btn" onClick={() => goTo(shift(day, -1))} aria-label="Día anterior"><IconChevronLeft size={14} /></button>
        <span className="px-2 font-label text-xs tabular text-[var(--text-body)]">{day}</span>
        <button className="btn" onClick={() => goTo(shift(day, 1))} aria-label="Día siguiente"><IconChevronRight size={14} /></button>
      </PageHeader>

      <Card rank="rubric" className="flex flex-col">
        <div className="gr-sangrado flex flex-wrap items-center gap-2">
          <span className="gr-rubrica">Entrada del día</span>
          <span className="hidden h-px flex-1 bg-[var(--gr-edge)] lg:block" />
          <span className="text-xs italic text-[var(--text-faint)]" aria-live="polite">{STATUS[editor.status]}</span>
          <button className="btn ml-auto lg:ml-0" onClick={() => setPreview(!preview)}>
            {preview ? <><IconPencil size={12} /> Editar</> : <><IconEye size={12} /> Vista</>}
          </button>
          <span className="gr-rombo hidden lg:inline-block" />
        </div>

        {editor.conflicts.map((c) => (
          <ConflictNotice
            key={c.id}
            conflict={c}
            onAppend={() => {
              editor.setContent(`${editor.content.trimEnd()}\n\n${c.content}`);
              editor.discardConflict(c.id);
            }}
            onDiscard={() => editor.discardConflict(c.id)}
          />
        ))}

        <div className="mt-4 gr-sangrado">
          {!editor.ready ? (
            <p className="text-xs text-[var(--text-muted)]">Cargando…</p>
          ) : preview ? (
            /* La capitular vive sólo aquí, en la vista y no en el textarea: al escribir, una letra
               flotada de tres líneas mueve el cursor (v1). */
            <div className="gr-prosa min-h-80"
                 dangerouslySetInnerHTML={{ __html: renderMarkdown(editor.content) || "<p style='color:var(--gr-ink-dim)'>Nada escrito.</p>" }} />
          ) : (
            <textarea
              className="input font-prose min-h-80 resize-y bg-[var(--gr-surface-sunken)]"
              placeholder="Escribe tu día… (Markdown: **negrita**, *cursiva*, - listas)"
              aria-label={`Entrada del ${day}`}
              value={editor.content}
              onChange={(e) => editor.setContent(e.target.value)}
              onBlur={() => void editor.commit()}
            />
          )}
        </div>

        {/* El pie de la entrada: dos filetes con un rombo en medio. Cierra la página escrita antes
            de las etiquetas, que son metadato y no texto. */}
        <div className="mt-auto gr-sangrado pt-4">
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className="h-px flex-1 bg-[var(--gr-edge)]" />
            <span className="gr-rombo" />
            <span className="h-px flex-1 bg-[var(--gr-edge)]" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-label text-xs text-[var(--text-muted)]">Etiquetas</span>
            <div className="min-w-0 flex-1">
              <TagInput value={editor.tags} onChange={editor.setTags} />
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        <Card title="Resumen del día">
          <SummaryRows summary={editor.summary} />
        </Card>

        <Card title={`${MONTHS_ES[month]} ${year}`}>
          <MiniCalendar month={month} year={year} marks={marks} selected={day} onSelect={goTo} />
        </Card>

        <SearchCard onPick={goTo} />

        <DiaryVolume today={day} points={volume.points} />
      </div>
    </div>
  );
}

/** Decisión 1: lo que se pisó sin verlo queda aparte. Se lee, se agrega al final o se descarta. */
function ConflictNotice({ conflict, onAppend, onDiscard }: {
  conflict: DiaryConflict; onAppend: () => void; onDiscard: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 gr-sangrado">
      <div className="rounded-md border border-[var(--gr-edge-strong)] bg-[var(--bg-elevated)] p-3">
        <p className="text-xs text-[var(--text-body)]">
          Otra versión de este día quedó guardada aparte: se escribió en otro dispositivo y este no la había visto.
        </p>
        {open && <p className="mt-2 whitespace-pre-wrap font-prose text-[var(--text-muted)]">{conflict.content}</p>}
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button className="btn" onClick={() => setOpen(!open)}>{open ? "Ocultar" : "Ver"}</button>
          <button className="btn" onClick={onAppend}>Agregar al final</button>
          <button className="btn" onClick={onDiscard}>Descartar</button>
        </div>
      </div>
    </div>
  );
}

function SummaryRows({ summary }: { summary: DaySummary | null }) {
  if (!summary) return <p className="text-xs text-[var(--text-muted)]">—</p>;
  return (
    <div className="space-y-2 text-xs text-[var(--text-body)]">
      <Row label="XP ganado" value={`${summary.xp_earned}`} />
      <Row label="Hábitos" value={`${summary.habits_done.length}`} />
      <Row label="Pomodoro" value={`${summary.pomodoro_sessions.length} ses · ${summary.pomodoro_minutes}m`} />
      {summary.habits_done.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {summary.habits_done.map((h, i) => (
            <span key={i} className="rounded-sm px-1.5 py-0.5 text-xs" style={{ background: "var(--bg-elevated)", color: h.color }}>{h.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchCard({ onPick }: { onPick: (day: string) => void }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const search = useDiarySearch(q);

  return (
    <Card title="Buscar en el volumen" icon={<IconSearch size={13} />}>
      <input className="input" placeholder="Buscar en entradas…" aria-label="Buscar en el diario"
             value={text} onChange={(e) => setText(e.target.value)} />
      {q && search.fetchStatus === "paused" && (
        <p className="mt-2 text-xs italic text-[var(--text-faint)]">Sin conexión: la búsqueda necesita señal.</p>
      )}
      {q && search.data?.length === 0 && (
        <p className="mt-2 text-xs italic text-[var(--text-faint)]">Nada con «{q}».</p>
      )}
      <div className="mt-2 max-h-48 overflow-y-auto">
        {search.data?.map((r) => (
          <button key={r.local_date} onClick={() => onPick(r.local_date)}
            className="block min-h-11 w-full border-b border-[var(--gr-edge)] py-1.5 text-left last:border-none lg:min-h-0">
            <div className="font-label text-xs text-[var(--purple-main)]">{r.local_date}</div>
            <div className="truncate text-xs text-[var(--text-muted)]">{r.snippet}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="tabular text-[var(--text-primary)]">{value}</span>
    </div>
  );
}
