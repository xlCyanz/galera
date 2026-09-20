import { useEffect, useEffectEvent, useState } from "react";

import {
  type SessionStatus,
  chooseProjectFile,
  chooseProjectFolder,
  errorMessage,
  exportPdf,
  openProject,
  saveProject,
  saveProjectAs,
  sessionStatus,
} from "./commands";
import { Canvas } from "./canvas/Canvas";
import {
  exportPdfShortcutLabel,
  historyShortcutLabel,
  isExportPdfShortcut,
  isMac,
  isSaveShortcut,
  saveShortcutLabel,
} from "./shortcuts";
import { useCompilation } from "./hooks/useCompilation";
import { runHistory, useUndoRedo } from "./hooks/useUndoRedo";
import { useCompilationStore } from "./store/compilation";
import { useLayoutStore } from "./store/layout";
import {
  useArchive,
  useCurrentPage,
  useDirty,
  useDocumentStore,
  useDocumentTitle,
  usePageCount,
  useProjectRoot,
} from "./store/document";
import { CloseDialog } from "./ui/CloseDialog";
import { Inspector } from "./ui/Inspector";
import { RecoveryNotice } from "./ui/RecoveryNotice";
import { SidePanels } from "./ui/SidePanels";
import { StatusBar } from "./ui/StatusBar";
import { ToolRail } from "./ui/ToolRail";

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
  const history = useUndoRedo();
  const title = useDocumentTitle();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = useDirty();
  const archive = useArchive();

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
  const canSave = title !== null && !saving;

  /**
   * Guarda donde ya estaba, o en otro sitio si se dice: una carpeta vacía o
   * un `.galera`. A partir de ahí se guarda ahí.
   */
  async function save(as?: "folder" | "archive") {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const saved = as === undefined ? await saveProject() : await saveProjectAs(as === "archive");
      if (saved !== null) {
        useDocumentStore.getState().saved(saved);
        setNotice(`Guardado en ${saved.path}`);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  // Un evento de efecto ve siempre el estado actual, así que el atajo se
  // registra una sola vez y no en cada render.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (canExport && isExportPdfShortcut(event, mac)) {
      event.preventDefault();
      void exportToPdf();
    } else if (canSave && isSaveShortcut(event, mac)) {
      event.preventDefault();
      void save();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  async function open(from: "folder" | "archive") {
    setError(null);
    setNotice(null);
    setOpening(true);
    try {
      const folder = from === "folder" ? await chooseProjectFolder() : await chooseProjectFile();
      if (folder !== null) {
        // El backend empieza a compilarlo solo; el resultado llega por
        // eventos (ver `hooks/useCompilation.ts`).
        const opened = await openProject(folder);
        useDocumentStore.getState().open(opened);
        useCompilationStore.getState().expect(opened.revision);
        useLayoutStore.getState().expect(opened.revision);
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
      <RecoveryNotice
        onRecovered={(opened) => {
          useDocumentStore.getState().open(opened);
          useCompilationStore.getState().expect(opened.revision);
          useLayoutStore.getState().expect(opened.revision);
          // Recuperar no guarda: queda por guardar, como cualquier cambio.
          useDocumentStore.setState({ dirty: true });
          setNotice("Recuperado lo que no se había guardado. Revísalo y guarda si está bien.");
        }}
      />
      <CloseDialog />
      <div className="actions">
        <button type="button" onClick={() => void open("folder")} disabled={opening}>
          Abrir carpeta…
        </button>
        <button type="button" onClick={() => void open("archive")} disabled={opening}>
          Abrir .galera…
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          aria-keyshortcuts={mac ? "Meta+S" : "Control+S"}
          title={archive === null ? "Guardar en la carpeta del proyecto" : `Guardar en ${archive}`}
        >
          {dirty ? "Guardar •" : "Guardar"} <kbd>{saveShortcutLabel(mac)}</kbd>
        </button>
        <button type="button" onClick={() => void save("folder")} disabled={!canSave}>
          Guardar como carpeta…
        </button>
        <button type="button" onClick={() => void save("archive")} disabled={!canSave}>
          Guardar como .galera…
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
        <button
          type="button"
          onClick={() => void runHistory("undo")}
          disabled={history.undo === null}
          aria-keyshortcuts={mac ? "Meta+Z" : "Control+Z"}
          title={historyShortcutLabel("undo", mac)}
        >
          {history.undo === null ? "Deshacer" : `Deshacer: ${history.undo}`}{" "}
          <kbd>{historyShortcutLabel("undo", mac)}</kbd>
        </button>
        <button
          type="button"
          onClick={() => void runHistory("redo")}
          disabled={history.redo === null}
          aria-keyshortcuts={mac ? "Meta+Shift+Z" : "Control+Shift+Z"}
          title={historyShortcutLabel("redo", mac)}
        >
          {history.redo === null ? "Rehacer" : `Rehacer: ${history.redo}`}{" "}
          <kbd>{historyShortcutLabel("redo", mac)}</kbd>
        </button>
        <button type="button" onClick={check}>
          Comprobar conexión con el núcleo
        </button>
      </div>
      {title !== null && <ProjectInfo title={title} />}
      <div className="workspace">
        {title !== null && <ToolRail />}
        <Canvas />
        {title !== null && (
          <div className="sidebar">
            <SidePanels />
            <Inspector />
          </div>
        )}
      </div>
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
      <StatusBar />
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
