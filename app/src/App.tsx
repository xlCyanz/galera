import { useState } from "react";

import { type SessionStatus, sessionStatus } from "./commands";

/**
 * Pantalla provisional. Solo comprueba que la interfaz, el backend en Rust y
 * `galera-core` están conectados. La estructura real de la pantalla llega con
 * F1-13, siguiendo el brief de diseño.
 */
export function App() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setError(null);
    try {
      setStatus(await sessionStatus());
    } catch (reason) {
      setStatus(null);
      setError(String(reason));
    }
  }

  return (
    <main className="galera">
      <h1>Galera</h1>
      <button type="button" onClick={check}>
        Comprobar conexión con el núcleo
      </button>
      {status !== null && (
        <dl role="status" className="ok">
          <dt>galera-core</dt>
          <dd>{status.coreVersion}</dd>
          <dt>Documento</dt>
          <dd>{status.title ?? "ninguno abierto"}</dd>
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
