import { ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import { motionTokens } from "../../theme-tokens";

/**
 * `rank` decide cuánto pesa la card, no sólo cómo se ve:
 *
 *   rubric      lo que el día exige. Una por vista.
 *   leaf        la card estándar (por defecto).
 *   marginalia  cifras de contexto; pierde la caja entera.
 *   pozo        panel hundido: gráficos y piezas dibujadas.
 *
 * Antes todas eran `leaf` y el Dashboard leía como un plano de ocho
 * rectángulos idénticos.
 */
export type CardRank = "rubric" | "leaf" | "marginalia" | "pozo";

const RANK_CLASS: Record<CardRank, string> = {
  rubric: "card-rubric",
  leaf: "",
  marginalia: "card-marginalia",
  /* `card-pozo` a secas: `.gr-pozo` no sirve aquí porque `.card` lo pisa con su
     `background` abreviado. Vive en index.css, con los otros rangos. */
  pozo: "card-pozo",
};

/* El nudo de esquina sale del rango, no de una prop.
 *
 * La regla del ornamento —oro en la tarjeta principal, tinta en las demás, una
 * sola de oro por pantalla— es palabra por palabra la regla de los rangos, que
 * ya está decidida en cada llamada. Pedirlo a mano habría sido una segunda
 * fuente de verdad de la misma jerarquía, y la primera vez que alguien pusiera
 * dos nudos de oro en una vista nada se lo diría.
 *
 * La marginalia y el pozo no llevan: ninguno tiene caja donde anclarlo. */
const NUDO: Record<CardRank, ReactNode> = {
  rubric: (
    <>
      <span className="gr-nudo gr-nudo--oro" />
      <span className="gr-nudo gr-nudo--oro gr-nudo--contra" />
    </>
  ),
  leaf: <span className="gr-nudo gr-nudo--tinta" />,
  marginalia: null,
  pozo: null,
};

/* La entrada no se pide: se hereda. La vista (App) anima de `hidden` a `show`
 * escalonando a sus hijos, y cada card responde con esto. Una card fuera de esa
 * orquestación —en un modal, en un test— no recibe nombre de variante y se
 * pinta quieta, que es lo correcto. Sustituye a la regla de ornamento.css que
 * animaba todas las `section` de golpe: con escalonado, el ojo recorre la vista
 * en el orden en que está escrita. */
export function cardEnter(): Variants {
  const t = motionTokens();
  return {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: t.enter, ease: t.easeOut } },
  };
}

export function Card({ title, icon, children, className = "", right, rank = "leaf", named }: {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
  rank?: CardRank;
  /**
   * El rótulo es un nombre propio, no una etiqueta: sube a versalitas Cinzel.
   *
   * «Tareas prioritarias» describe lo que hay dentro y se encoge para que pese
   * el contenido. «El libro de cuentas» y «Las arcas» son cómo se llaman esas
   * cosas en el erario, y un nombre propio en Inter de 11px se lee como un
   * campo de formulario. La distinción es la misma que separa un rótulo de una
   * rúbrica, y por eso comparte tratamiento con ella.
   */
  named?: boolean;
}) {
  return (
    <motion.section variants={cardEnter()} className={`card ${RANK_CLASS[rank]} ${className}`.replace(/\s+/g, " ").trim()}>
      {NUDO[rank]}
      {title && (
        <div className={`section-title ${rank === "rubric" ? "mb-3" : "mb-2.5"} ${NUDO[rank] ? "gr-sangrado" : ""}`}>
          {/* Icono de rótulo, no de estado: en tinta. Era la mayor fuente de
              morado ambiental de la app, y con él encendido el oro no se lee. */}
          {icon && <span className="text-[var(--text-muted)]">{icon}</span>}
          {/* El texto del título lleva clase propia: la rúbrica le pone Cinzel,
              y sin este gancho la regla alcanzaba a toda la fila —incluido
              `right`— y las cifras salían en display con tracking de versalita. */}
          <span className={`section-title-text ${named ? "gr-rubrica" : ""}`}>{title}</span>
          {/* En la rúbrica la cifra acompaña al título en vez de irse al borde:
              a 250px de distancia leían como dos cosas, no como una. */}
          {right && (
            <span className={`normal-case ${rank === "rubric" ? "ml-3" : "ml-auto"}`}>{right}</span>
          )}
        </div>
      )}
      {children}
    </motion.section>
  );
}
