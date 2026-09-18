import { useEffect, useEffectEvent, useState } from "react";

import {
  type SessionStatus,
  chooseProjectFolder,
  errorMessage,
  exportPdf,
  openProject,
  sessionStatus,
} from "./commands";
import { Canvas } from "./canvas/Canvas";
import { compilationSummary } from "./format";
import { exportPdfShortcutLabel, isExportPdfShortcut, isMac } from "./shortcuts";
import { useCompilation } from "./hooks/useCompilation";
import {
  useCompilationError,
  useCompilationMs,
  useCompilationReused,
  useCompilationStatus,
  useCompilationStore,
  useDiagnostics,
} from "./store/compilation";
import {
  useCurrentPage,
  useDocumentStore,
  useDocumentTitle,
  usePageCount,
  useProjectRoot,
} from "./store/document";

const mac = isMac();

/**
 * Pantalla provisional. Abre un proyecto, enseña sus páginas en el lienzo
 * tal como las compila Typst y comprueba que la interfaz, el backend en Rust
 * y `galera-core` están conectados. La estructura real de la pantalla llega
 * con F1-13, siguiendo el brief de diseño.
 *
 * El documento y la compilación viven en los stores (`store/`); aquí solo
 * queda el estado de los propios botones y mensajes.
 */
export function App() {
  useCompilation();
  const title = useDocumentTitle();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function exportToPdf() {
    setError(null);
    setNotice(null);
    setExporting(true);
    try {
      const exported = await exportPdf();
      if (exported !== null) {
        setNotice(`PDF guardado en ${exported.path}`);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setExporting(false);
    }
  }

  const canExport = title !== null && !exporting;

  // Un evento de efecto ve siempre el estado actual, así que el atajo se
  // registra una sola vez y no en cada render.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (canExport && isExportPdfShortcut(event, mac)) {
      event.preventDefault();
      void exportToPdf();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  async function open() {
    setError(null);
    setNotice(null);
    setOpening(true);
    try {
      const folder = await chooseProjectFolder();
      if (folder !== null) {
        // El backend empieza a compilarlo solo; el resultado llega por
        // eventos (ver `hooks/useCompilation.ts`).
        const opened = await openProject(folder);
        useDocumentStore.getState().open(opened);
        useCompilationStore.getState().expect(opened.revision);
      }
    } catch (reason) {
      // Si falla, el backend conserva lo que hubiera abierto, así que aquí
      // también se conserva.
      setError(errorMessage(reason));
    } finally {
      setOpening(false);
    }
  }

  async function check() {
    setError(null);
    try {
      setStatus(await sessionStatus());
    } catch (reason) {
      setStatus(null);
      setError(errorMessage(reason));
    }
  }

  return (
    <main className="galera">
      <h1>Galera</h1>
      <div className="actions">
        <button type="button" onClick={open} disabled={opening}>
          Abrir proyecto…
        </button>
        <button
          type="button"
          onClick={exportToPdf}
          disabled={!canExport}
          aria-keyshortcuts={mac ? "Meta+Shift+E" : "Control+Shift+E"}
          title={exportPdfShortcutLabel(mac)}
        >
          Exportar a PDF… <kbd>{exportPdfShortcutLabel(mac)}</kbd>
        </button>
        <button type="button" onClick={check}>
          Comprobar conexión con el núcleo
        </button>
      </div>
      {title !== null && <ProjectInfo title={title} />}
      <CompilationInfo />
      <Canvas />
      {status !== null && (
        <dl className="ok">
          <dt>galera-core</dt>
          <dd>{status.coreVersion}</dd>
          <dt>Abierto en el backend</dt>
          <dd>{status.title ?? "nada"}</dd>
        </dl>
      )}
      {notice !== null && (
        <p role="status" className="ok">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  );
}

/** Título, carpeta y la página que se ve, con botones para cambiarla. */
function ProjectInfo({ title }: { title: string }) {
  const pageCount = usePageCount();
  const currentPage = useCurrentPage();
  const root = useProjectRoot();
  const { setCurrentPage } = useDocumentStore.getState();

  return (
    <div className="project">
      <dl role="status" className="ok">
        <dt>Documento</dt>
        <dd>{title}</dd>
        <dt>Carpeta</dt>
        <dd>{root}</dd>
      </dl>
      <nav className="actions" aria-label="Páginas">
        <button
          type="button"
          onClick={() => setCurrentPage(currentPage - 1)}
          disabled={currentPage === 0}
        >
          Página anterior
        </button>
        <span>
          Página {pageCount === 0 ? 0 : currentPage + 1} de {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setCurrentPage(currentPage + 1)}
          disabled={currentPage >= pageCount - 1}
        >
          Página siguiente
        </button>
      </nav>
    </div>
  );
}

/** Cuánto tardó la última compilación y, si falla, por qué. */
function CompilationInfo() {
  const status = useCompilationStatus();
  const ms = useCompilationMs();
  const reused = useCompilationReused();
  const pageCount = usePageCount();
  const diagnostics = useDiagnostics();
  const failure = useCompilationError();

  if (status === "idle") {
    return null;
  }

  return (
    <section className="compilation" aria-label="Compilación">
      <p>{status === "compiling" ? "Compilando…" : compilationSummary(pageCount, ms, reused)}</p>
      {failure !== null && (
        <p role="alert" className="error">
          {failure.message}
        </p>
      )}
      {failure === null && diagnostics.length > 0 && (
        <ul className="warnings">
          {diagnostics.map((warning, index) => (
            <li key={index}>{warning.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
