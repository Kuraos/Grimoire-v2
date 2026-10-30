import { useMemo } from "react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "../bklit";
import { formatMoney, moneyDecimals } from "../../utils";
import { ChartEmpty, fixedHeight, MARGIN } from "./kit";

/**
 * El gasto día a día del mes, en barras.
 *
 * Era un mapa de calor de veintisiete semanas. Un heatmap contesta «¿qué días
 * gasté?» pero no «¿cuánto?»: la intensidad de una celda de 11px no se compara
 * con la de otra a diez columnas de distancia, y la pregunta que se hace alguien
 * mirando el mes es justamente cuál fue el día caro y por cuánto. En barras eso
 * se lee de un vistazo y además se puede sumar con la mirada.
 *
 * Las barras van en ÁMBAR, no en dorado ni en arcano. Es la misma razón por la
 * que la rampa del heatmap terminaba en ámbar: más gasto no es mejor, y una
 * barra dorada premiaría el día que peor salió. El ámbar es advertencia, que es
 * lo que un pico de gasto es.
 *
 * El día más caro va en oxblood. Bklit pinta cada serie de un solo color, así
 * que ese día vive en su propia serie apilada: en cada columna sólo una de las
 * dos tiene valor.
 */
export function SpendDaily({ data, currency, month }: {
  data: { date: string; expense_minor: number }[];
  currency: string;
  /** "2026-08". Sin él, el mes en curso. */
  month?: string;
}) {
  const dec = moneyDecimals(currency);

  const { rows, max } = useMemo(() => {
    const key = month ?? new Date().toISOString().slice(0, 7);
    const [y, m] = key.split("-").map(Number);
    const days = new Date(y, m, 0).getDate();
    const map = new Map(data.map((d) => [d.date, d.expense_minor]));
    // Todos los días del mes, también los de cero: los huecos son parte del
    // dibujo. Con sólo los días con gasto, un mes de tres compras parecía
    // continuo y no se veía que fueron tres.
    const all = Array.from({ length: days }, (_, i) => {
      const iso = `${key}-${String(i + 1).padStart(2, "0")}`;
      return { day: String(i + 1), minor: map.get(iso) ?? 0 };
    });
    const max = Math.max(0, ...all.map((r) => r.minor));
    return {
      max,
      rows: all.map((r) => {
        const v = r.minor / 10 ** dec;
        return { day: r.day, minor: r.minor, gasto: r.minor === max ? 0 : v, pico: r.minor === max ? v : 0 };
      }),
    };
  }, [data, month, dec]);

  if (max <= 0) return <ChartEmpty>Ningún gasto anotado este mes.</ChartEmpty>;

  return (
    <BarChart data={rows} xDataKey="day" stacked margin={{ ...MARGIN, left: 8 }} barGap={0.3} {...fixedHeight(160)}>
      <Grid horizontal numTicksRows={3} />
      <Bar dataKey="gasto" fill="var(--gr-amber)" lineCap={2} />
      <Bar dataKey="pico" fill="var(--gr-oxblood)" lineCap={2} />
      {/* Un rótulo por semana: treinta y un números seguidos a 11px se
          solapan y dejan de leerse. */}
      <BarXAxis maxLabels={5} />
      <ChartTooltip
        rows={(p: Record<string, unknown>) => [{
          color: (p.pico as number) > 0 ? "var(--gr-oxblood)" : "var(--gr-amber)",
          label: `Día ${p.day}`,
          value: formatMoney(p.minor as number, currency),
        }]}
      />
    </BarChart>
  );
}
