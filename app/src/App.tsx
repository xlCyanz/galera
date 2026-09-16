import { useState } from "react";

import {
  type OpenedProject,
  type SessionStatus,
  chooseProjectFolder,
  errorMessage,
  openProject,
  sessionStatus,
} from "./commands";

/**
 * Pantalla provisional. Abre un proyecto y enseña lo que el backend ha
 * cargado, y comprueba que la interfaz, el backend en Rust y `galera-core`
 * están conectados. El lienzo llega con F1-08 y la estructura real de la
 * pantalla con F1-13, siguiendo el brief de diseño.
 */
export function App() {
  const [project, setProject] = useState<OpenedProject | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function open() {
    setError(null);
    setOpening(true);
    try {
      const folder = await chooseProjectFolder();
      if (folder !== null) {
        setProject(await openProject(folder));
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
      {status !== null && (
        <dl className="ok">
          <dt>galera-core</dt>
          <dd>{status.coreVersion}</dd>
          <dt>Abierto en el backend</dt>
          <dd>{status.title ?? "nada"}</dd>
        </dl>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  );
}
