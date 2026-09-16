import { useState } from "react";

import { ping } from "./commands";

/**
 * Pantalla provisional. La ventana arranca vacía salvo por una comprobación
 * de que la interfaz y el backend en Rust se hablan. La estructura real de la
 * pantalla llega con F1-13, siguiendo el brief de diseño.
 */
export function App() {
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setError(null);
    try {
      setReply(await ping("hola desde React"));
    } catch (reason) {
      setReply(null);
      setError(String(reason));
    }
  }

  return (
    <main className="galera">
      <h1>Galera</h1>
      <button type="button" onClick={check}>
        Probar conexión con el backend
      </button>
      {reply !== null && (
        <p role="status" className="ok">
          {reply}
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
