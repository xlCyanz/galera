import { useState } from "react";

import {
  type OpenedProject,
  type SessionStatus,
  chooseProjectFile,
  chooseProjectFolder,
  newProject,
  errorMessage,
  exportPdf,
  openProject,
  saveProject,
  saveProjectAs,
  sessionStatus,
} from "./commands";
import { Canvas } from "./canvas/Canvas";
import { isMac, shortcutLabel } from "./shortcuts";
import { useShortcut } from "./hooks/useShortcuts";
import { useClipboard } from "./hooks/useClipboard";
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
import { ExportDialog } from "./ui/ExportDialog";
import { Inspector } from "./ui/Inspector";
import { ShortcutsHelp } from "./ui/ShortcutsHelp";
import { RecoveryNotice } from "./ui/RecoveryNotice";
import { SidePanels } from "./ui/SidePanels";
import { StatusBar } from "./ui/StatusBar";
import { TemplateGallery } from "./ui/TemplateGallery";
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
  // ⌘C, ⌘X, ⌘V y ⌘D sobre lo seleccionado.
  useClipboard();
  const history = useUndoRedo();
  const title = useDocumentTitle();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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

  // Los atajos se registran por id; el listener es único (`useShortcuts.ts`).
  useShortcut("exportPdf", () => void exportToPdf(), canExport);
  useShortcut("save", () => void save(), canSave);
  useShortcut("saveAs", () => void save("archive"), canSave);
  useShortcut("newProject", () => void create(false), !opening);
  useShortcut("newArchive", () => void create(true), !opening);
  useShortcut("openFolder", () => void open("folder"), !opening);
  useShortcut("openArchive", () => void open("archive"), !opening);

  /** Enseña un proyecto recién abierto o creado, y espera su compilación. */
  function show(opened: OpenedProject) {
    useDocumentStore.getState().open(opened);
    useCompilationStore.getState().expect(opened.revision);
    useLayoutStore.getState().expect(opened.revision);
  }

  /** Crea un proyecto vacío y lo abre, como si se acabara de abrir. */
  async function create(archive: boolean) {
    setError(null);
    setNotice(null);
    setOpening(true);
    try {
      const created = await newProject(archive);
      if (created !== null) {
        show(created);
        setNotice(`Proyecto nuevo en ${created.archive ?? created.root}`);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setOpening(false);
    }
  }

  async function open(from: "folder" | "archive") {
    setError(null);
    setNotice(null);
    setOpening(true);
    try {
      const folder = from === "folder" ? await chooseProjectFolder() : await chooseProjectFile();
      if (folder !== null) {
        // El backend empieza a compilarlo solo; el resultado llega por
        // eventos (ver `hooks/useCompilation.ts`).
        show(await openProject(folder));
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
        <button
          type="button"
          onClick={() => void create(false)}
          disabled={opening}
          aria-keyshortcuts={mac ? "Meta+N" : "Control+N"}
          title={`Crear un proyecto vacío en una carpeta (${shortcutLabel("newProject", mac)})`}
        >
          Nuevo proyecto… <kbd>{shortcutLabel("newProject", mac)}</kbd>
        </button>
        <button
          type="button"
          onClick={() => void create(true)}
          disabled={opening}
          title={`Crear un proyecto vacío como archivo (${shortcutLabel("newArchive", mac)})`}
        >
          Nuevo .galera…
        </button>
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
          {dirty ? "Guardar •" : "Guardar"} <kbd>{shortcutLabel("save", mac)}</kbd>
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
          title={shortcutLabel("exportPdf", mac)}
        >
          Exportar a PDF… <kbd>{shortcutLabel("exportPdf", mac)}</kbd>
        </button>
        <button
          type="button"
          onClick={() => setExportOpen((open) => !open)}
          disabled={title === null}
          aria-expanded={exportOpen}
        >
          Exportar a…
        </button>
        <button
          type="button"
          onClick={() => void runHistory("undo")}
          disabled={history.undo === null}
          aria-keyshortcuts={mac ? "Meta+Z" : "Control+Z"}
          title={shortcutLabel("undo", mac)}
        >
          {history.undo === null ? "Deshacer" : `Deshacer: ${history.undo}`}{" "}
          <kbd>{shortcutLabel("undo", mac)}</kbd>
        </button>
        <button
          type="button"
          onClick={() => void runHistory("redo")}
          disabled={history.redo === null}
          aria-keyshortcuts={mac ? "Meta+Shift+Z" : "Control+Shift+Z"}
          title={shortcutLabel("redo", mac)}
        >
          {history.redo === null ? "Rehacer" : `Rehacer: ${history.redo}`}{" "}
          <kbd>{shortcutLabel("redo", mac)}</kbd>
        </button>
        <ShortcutsHelp />
        <button type="button" onClick={check}>
          Comprobar conexión con el núcleo
        </button>
      </div>
      {title !== null && <ProjectInfo title={title} />}
      {title === null && <TemplateGallery />}
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
      {exportOpen && (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          onDone={(done) => {
            setError(null);
            setNotice(done);
          }}
        />
      )}
      {/* Siempre montado: una región que avisa en voz baja solo se anuncia
          si ya estaba cuando cambia su texto, no si nace con él (F8-03). */}
      <p role="status" className={notice === null ? "visually-hidden" : "ok"}>
        {notice ?? ""}
      </p>
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
