import { ReactNode } from "react";

/**
 * La cabecera de vista: rúbrica de 44px sobre una tarjeta con nudo de oro.
 *
 * Antes el título flotaba suelto sobre el fondo y las nueve vistas empezaban
 * con un vacío. Puesto sobre superficie, con el nudo marcando la esquina, la
 * cabecera se lee como la portada de la sección — que es lo que es.
 *
 * `context` es la línea que dice de qué va el día en esta vista: cifras que la
 * página ya tiene a mano, en cursiva y alineadas al pie del título. No es
 * decoración, es lo primero que se quiere saber al entrar.
 *
 * El nudo va en oro aunque no sea la tarjeta principal: la cabecera está fuera
 * del reparto de rangos —no compite con ninguna card— y por eso lleva la
 * variante `--cabecera`, que baja el trazo para no gritar dos veces.
 */
export function PageHeader({ title, context, children, className = "" }: {
  title: string;
  context?: ReactNode;
  children?: ReactNode;
  /** Las vistas en rejilla la necesitan para ocupar el ancho completo. */
  className?: string;
}) {
  return (
    <div className={`card flex flex-wrap items-center gap-x-5 gap-y-2 py-3.5 pl-12 pr-[18px] ${className}`.trim()}>
      <span className="gr-nudo gr-nudo--oro gr-nudo--cabecera" />
      <h1 className="gr-title-module">{title}</h1>
      {context && (
        <span className="self-end pb-1.5 text-xs italic text-[var(--text-muted)]">{context}</span>
      )}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
