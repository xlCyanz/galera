/**
 * El panel de problemas de la compilación: cada error o aviso con el mensaje
 * literal de Typst, sus sugerencias y, si se sabe, un enlace al elemento.
 */
import { useDocumentStore } from "../store/document";
import type { Issue } from "./issues";

export interface ErrorPanelProps {
  issues: readonly Issue[];
}

export function ErrorPanel({ issues }: ErrorPanelProps) {
  return (
    <section className="issues" aria-label="Problemas de la compilación">
      <ul>
        {issues.map((issue, index) => (
          <li key={index} className={`issue is-${issue.severity}`}>
            <span className="issue-severity">{issue.severity === "error" ? "Error" : "Aviso"}</span>
            <div className="issue-body">
              {/* Tal cual lo da Typst: sin traducir ni resumir. */}
              <p className="issue-message">{issue.message}</p>
              {issue.hints.map((hint, hintIndex) => (
                <p key={hintIndex} className="issue-hint">
                  Sugerencia: {hint}
                </p>
              ))}
            </div>
            {issue.elementId !== null && <ElementLink id={issue.elementId} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Lleva el lienzo al elemento: su página, centrado y resaltado. */
function ElementLink({ id }: { id: string }) {
  return (
    <button
      type="button"
      className="issue-element"
      onClick={() => useDocumentStore.getState().focusElement(id)}
      title="Ir al elemento en el lienzo"
    >
      Ir a «{id}»
    </button>
  );
}
