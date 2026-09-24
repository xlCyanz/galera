/**
 * La barra de estado, abajo del todo: cómo fue la última compilación y
 * cuánto tardó, cuántos errores y avisos hay, la página y el zoom.
 *
 * El recuento abre y cierra el panel de problemas (`ErrorPanel.tsx`), que se
 * abre solo cuando aparece un error nuevo. Mientras hay errores, el lienzo
 * sigue enseñando la última compilación buena (ver `store/compilation.ts`).
 */
import { useEffect, useMemo, useState } from "react";

import { formatZoom } from "../canvas/zoom";
import { compilationStatusText } from "../format";
import {
  useCompilationError,
  useCompilationMs,
  useCompilationReused,
  useCompilationStatus,
  useDiagnostics,
} from "../store/compilation";
import { useCurrentPage, usePageCount, useZoom } from "../store/document";
import { ErrorPanel } from "./ErrorPanel";
import { ThemeSelect } from "./ThemeSelect";
import { countIssues, issuesOf, issuesSummary } from "./issues";

export function StatusBar() {
  const status = useCompilationStatus();
  const ms = useCompilationMs();
  const reused = useCompilationReused();
  const diagnostics = useDiagnostics();
  const error = useCompilationError();
  const pageCount = usePageCount();
  const currentPage = useCurrentPage();
  const zoom = useZoom();

  const issues = useMemo(() => issuesOf(diagnostics, error), [diagnostics, error]);
  const { errors } = countIssues(issues);
  const summary = issuesSummary(issues);
  const [panelOpen, setPanelOpen] = useState(false);

  // Un error nuevo abre el panel; si se arregla, se cierra.
  useEffect(() => {
    setPanelOpen(errors > 0);
  }, [errors, error]);

  return (
    <>
      {panelOpen && issues.length > 0 && <ErrorPanel issues={issues} />}
      <footer className="status-bar">
        <span className={`status-compilation is-${status}`} role="status">
          {compilationStatusText(status, ms, reused)}
        </span>
        {summary !== null && (
          <button
            type="button"
            className={errors > 0 ? "status-issues has-errors" : "status-issues"}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            {summary}
          </button>
        )}
        <span className="status-spacer" />
        {pageCount > 0 && (
          <>
            <span>
              Página {currentPage + 1} de {pageCount}
            </span>
            <span className="status-zoom">{formatZoom(zoom)}</span>
          </>
        )}
        <ThemeSelect />
      </footer>
    </>
  );
}
