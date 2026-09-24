/**
 * La barra de estado, abajo del todo: cómo fue la última compilación y
 * cuánto tardó, cuántos errores y avisos hay, la página y el zoom.
 *
 * El recuento abre y cierra el panel de problemas (`ErrorPanel.tsx`), que se
 * abre solo cuando aparece un error nuevo. Mientras hay errores, el lienzo
 * sigue enseñando la última compilación buena (ver `store/compilation.ts`).
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { formatZoom } from "../canvas/zoom";
import { SLOW_COMPILATION_MS, compilationAnnouncement, compilationStatusText } from "../format";
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
  // Lo que se dice al lector de pantalla, en una región que está siempre y
  // solo cambia de texto (F8-03, #90). Ver `compilationAnnouncement`.
  const [spoken, setSpoken] = useState("");
  const settled = useRef<typeof status>("idle");
  const slow = useRef(false);
  useEffect(() => {
    if (status === "compiling") {
      // Solo si tarda: una compilación de cada tecla no se anuncia.
      const timer = setTimeout(() => {
        slow.current = true;
        setSpoken("Compilando…");
      }, SLOW_COMPILATION_MS);
      return () => clearTimeout(timer);
    }
    const said = compilationAnnouncement(settled.current, status, summary);
    if (said !== null) {
      setSpoken(said);
    } else if (slow.current && status === "ready") {
      // Se dijo que se compilaba: se dice también que acabó.
      setSpoken("Compilado");
    }
    slow.current = false;
    if (status === "ready" || status === "error") {
      settled.current = status;
    }
  }, [status, summary]);

  // Un error nuevo abre el panel; si se arregla, se cierra.
  useEffect(() => {
    setPanelOpen(errors > 0);
  }, [errors, error]);

  return (
    <>
      {panelOpen && issues.length > 0 && <ErrorPanel issues={issues} />}
      <footer className="status-bar">
        {/* Lo que se ve cambia en cada tecla; lo que se oye va aparte. */}
        <span className={`status-compilation is-${status}`}>{compilationStatusText(status, ms, reused)}</span>
        <span className="visually-hidden" role="status">
          {spoken}
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
