import { useEffect, useEffectEvent, useState } from "react";

import {
  type OpenedProject,
  type RenderedPage,
  type SessionStatus,
  chooseProjectFolder,
  errorMessage,
  exportPdf,
  openProject,
  renderPage,
  sessionStatus,
} from "./commands";
import { compilationSummary, svgDataUrl } from "./preview";
import { exportPdfShortcutLabel, isExportPdfShortcut, isMac } from "./shortcuts";

const mac = isMac();

/**
 * Pantalla provisional. Abre un proyecto, enseña sus páginas tal como las
 * compila Typst y comprueba que la interfaz, el backend en Rust y
 * `galera-core` están conectados. El lienzo llega con F1-08 y la estructura
 * real de la pantalla con F1-13, siguiendo el brief de diseño.
 */
export function App() {
  const [project, setProject] = useState<OpenedProject | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
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

  const canExport = project !== null && !exporting;

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
        const opened = await openProject(folder);
        setProject(opened);
        // Todas las páginas a la vez: el backend compila una sola vez.
        setPages(
          await Promise.all(opened.document.pages.map((_, index) => renderPage(index))),
        );
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
      {project !== null && (
        <dl role="status" className="ok">
          <dt>Documento</dt>
          <dd>{project.document.meta.title}</dd>
          <dt>Páginas</dt>
          <dd>{project.document.pages.length}</dd>
          <dt>Carpeta</dt>
          <dd>{project.root}</dd>
        </dl>
      )}
      {pages.length > 0 && <Preview pages={pages} />}
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

/** Las páginas compiladas, o por qué no compila el documento. */
function Preview({ pages }: { pages: readonly RenderedPage[] }) {
  // Si no compila, todas las páginas traen el mismo error.
  const failed = pages.find((page) => page.error !== null);
  const warnings = pages[0]?.diagnostics ?? [];

  return (
    <section className="preview" aria-label="Vista previa">
      <p>{compilationSummary(pages)}</p>
      {failed?.error != null && (
        <p role="alert" className="error">
          {failed.error.message}
        </p>
      )}
      {failed === undefined && warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((warning, index) => (
            <li key={index}>{warning.message}</li>
          ))}
        </ul>
      )}
      <div className="pages">
        {pages.map((page, index) =>
          page.svg === null ? null : (
            <img key={index} src={svgDataUrl(page.svg)} alt={`Página ${index + 1}`} />
          ),
        )}
      </div>
    </section>
  );
}
