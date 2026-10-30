import { Component, ReactNode } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

interface Props { children: ReactNode; scope?: string }
interface State { error: Error | null }

/**
 * Sin esto, un error de render en cualquier vista deja la app entera en blanco
 * y sin salida. Al envolver sólo el área de contenido, el fallo queda acotado:
 * la barra lateral sigue viva y se puede navegar a otra sección.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // deja rastro en la consola para poder diagnosticar
    console.error(`[Grimoire${this.props.scope ? " · " + this.props.scope : ""}]`, error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="gr-enter mx-auto mt-8 max-w-lg">
        <div className="card">
          <div className="flex items-center gap-2">
            <IconAlertTriangle size={18} style={{ color: "var(--gr-amber)" }} />
            <h2 className="gr-emphasis" style={{ color: "var(--gr-ink-bright)" }}>
              Algo se quebró en esta vista
            </h2>
          </div>

          <p className="gr-body mt-3" style={{ color: "var(--gr-ink-dim)" }}>
            El resto de Grimoire sigue funcionando: puedes cambiar de sección en la
            barra lateral. Tus datos no se han visto afectados.
          </p>

          <pre
            className="gr-meta mt-3 max-h-32 overflow-auto rounded-md p-2"
            style={{ background: "var(--gr-surface-sunken)", color: "var(--gr-ink-faint)",
                     border: "1px solid var(--gr-edge)", whiteSpace: "pre-wrap" }}
          >
            {error.message || String(error)}
          </pre>

          <div className="mt-4 flex gap-2">
            <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              <IconRefresh size={13} /> Reintentar
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Recargar la app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
