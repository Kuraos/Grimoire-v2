import { WEEKDAYS_ES, isoDate, monthCells } from "../../utils";

/**
 * Small month grid (week starts Monday). `marks` maps ISO date → array of dot colors.
 */
export function MiniCalendar({
  month, year, marks = {}, selected, onSelect,
}: {
  month: number; // 0-indexed
  year: number;
  marks?: Record<string, string[]>;
  selected?: string;
  onSelect?: (iso: string) => void;
}) {
  const todayIso = isoDate(new Date());
  const cells = monthCells(year, month);

  return (
    <div>
      <div className="grid grid-cols-7 gap-[2px] text-center">
        {WEEKDAYS_ES.map((w) => (
          <div key={w} className="py-[3px] text-xs text-[var(--text-faint)]">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const iso = isoDate(new Date(year, month, d));
          const dots = marks[iso] ?? [];
          const isToday = iso === todayIso;
          const isSel = iso === selected;
          return (
            <button
              key={i}
              onClick={() => onSelect?.(iso)}
              className={`relative rounded-sm py-[3px] text-xs tabular transition-colors ${
                isSel
                  ? "bg-[var(--border-accent)] text-[var(--gr-arcane-bright)]"
                  : isToday
                  ? "bg-[var(--purple-deep)] text-[var(--gr-arcane-bright)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              {d}
              {dots.length > 0 && (
                <span className="absolute inset-x-0 bottom-[1px] flex justify-center gap-[1px]">
                  {dots.slice(0, 4).map((c, j) => (
                    <span key={j} className="h-[3px] w-[3px] rounded-full" style={{ background: c }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
