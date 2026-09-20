/**
 * El aviso de recuperación: al arrancar, si quedó una copia de
 * autoguardado más nueva que lo guardado, se ofrece abrirla.
 *
 * Recuperar abre el proyecto con el documento de la copia, **sin guardarlo**:
 * queda como cambios sin guardar, para mirarlo y decidir. Descartar tira la
 * copia y deja el proyecto como está guardado.
 */
import { useEffect, useState } from "react";

import {
  type OpenedProject,
  type Recovery,
  discardRecovery,
  errorMessage,
  pendingRecoveries,
  recover,
} from "../commands";

export interface RecoveryNoticeProps {
  /** Se ha recuperado un proyecto: hay que abrirlo en la interfaz. */
  onRecovered: (opened: OpenedProject) => void;
}

/** Cuándo se autoguardó, en palabras: «hace 3 minutos». */
export function howLongAgo(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round(now - savedAt));
  if (seconds < 60) {
    return "hace menos de un minuto";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  }
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

/** El nombre del proyecto, para enseñarlo. */
function name(target: string): string {
  return target.split("/").at(-1) ?? target;
}

export function RecoveryNotice({ onRecovered }: RecoveryNoticeProps) {
  const [pending, setPending] = useState<Recovery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let gone = false;
    pendingRecoveries()
      .then((found) => {
        if (!gone && Array.isArray(found)) {
          setPending(found);
        }
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, []);

  const first = pending[0];
  if (first === undefined) {
    return null;
  }

  const forget = (target: string) => setPending((rest) => rest.filter((one) => one.target !== target));

  return (
    <div className="recovery-notice" role="alert">
      <p>
        <strong>{name(first.target)}</strong> tiene cambios sin guardar de{" "}
        {howLongAgo(first.savedAt, Date.now() / 1000)}
        {first.projectSavedAt === null ? ", y el proyecto ya no está donde estaba." : "."}
      </p>
      {error !== null && <p className="recovery-error">{error}</p>}
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            recover(first.target)
              .then((opened) => {
                forget(first.target);
                onRecovered(opened);
              })
              .catch((reason: unknown) => setError(errorMessage(reason)))
              .finally(() => setBusy(false));
          }}
        >
          Recuperar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            discardRecovery(first.target)
              .catch(() => undefined)
              .finally(() => forget(first.target));
          }}
        >
          Descartar
        </button>
      </div>
    </div>
  );
}
