/**
 * Qué hacer al cerrar con cambios sin guardar.
 *
 * El backend no cierra la ventana: avisa (`app:close-requested`) y espera.
 * Aquí se pregunta, y según lo que se elija se guarda y se cierra, se cierra
 * sin guardar, o no se cierra.
 */
import { useEffect, useRef, useState } from "react";

import { closeWindow, errorMessage, onCloseRequested, saveProject } from "../commands";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useDocumentStore } from "../store/document";

export interface CloseDialogProps {
  /** Solo para pruebas: cómo escuchar el aviso de cierre. */
  subscribe?: (handler: () => void) => Promise<() => void>;
}

export function CloseDialog({ subscribe = onCloseRequested }: CloseDialogProps) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let gone = false;
    subscribe(() => setAsking(true))
      .then((stop) => {
        if (gone) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [subscribe]);

  // El foco entra al preguntar, no se sale, y Esc es «Cancelar».
  useDialogFocus(dialog, { active: asking, onEscape: () => setAsking(false) });

  if (!asking) {
    return null;
  }

  const leave = () => {
    closeWindow()
      .then(() => {
        // La ventana se va; el diálogo ya no pinta nada.
        setAsking(false);
        setBusy(false);
      })
      .catch((reason: unknown) => {
        setError(errorMessage(reason));
        setBusy(false);
      });
  };

  return (
    <div className="close-dialog-backdrop">
      <div
        ref={dialog}
        tabIndex={-1}
        className="close-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Cambios sin guardar"
      >
        <p>Hay cambios sin guardar en este proyecto.</p>
        {error !== null && <p className="recovery-error">{error}</p>}
        <div className="actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              saveProject()
                .then((saved) => {
                  useDocumentStore.getState().saved(saved);
                  leave();
                })
                .catch((reason: unknown) => {
                  setError(errorMessage(reason));
                  setBusy(false);
                });
            }}
          >
            Guardar y salir
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              leave();
            }}
          >
            Salir sin guardar
          </button>
          <button type="button" disabled={busy} onClick={() => setAsking(false)}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
