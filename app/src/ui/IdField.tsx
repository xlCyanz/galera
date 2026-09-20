/**
 * El id de un elemento, editable con doble clic.
 *
 * El id no es solo cosa de la app: se ve en el JSON, en los errores de
 * compilación y en la etiqueta `<el-ID>` del código Typst, así que se puede
 * elegir. Es distinto del **nombre** del panel de capas, que solo se enseña
 * en la interfaz.
 *
 * Cambiarlo es un `Op::Rename`: entra en el historial. Un id repetido o con
 * caracteres que no valen lo rechaza el núcleo y aquí se dice, sin cambiar
 * nada.
 */
import { type KeyboardEvent, useRef, useState } from "react";

import { applyOp, errorMessage } from "../commands";
import { useDocumentStore } from "../store/document";

export function IdField({ id }: { id: string }) {
  // Lo escrito mientras se renombra; `null` mientras solo se enseña.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Esc quita el foco, y el `blur` llega después: sin esto, ese `blur`
  // aplicaría lo que se acababa de descartar.
  const cancelled = useRef(false);

  const finish = (commit: boolean) => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const to = draft?.trim() ?? "";
    setDraft(null);
    if (!commit || to === "" || to === id) {
      setError(null);
      return;
    }
    void applyOp({ op: "rename", id, to })
      .then((applied) => {
        useDocumentStore.getState().applyEdit(applied);
        // La selección va por id: sigue al elemento renombrado.
        useDocumentStore.getState().select(to);
        setError(null);
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelled.current = true;
      setDraft(null);
      setError(null);
      event.currentTarget.blur();
    }
  };

  return (
    <>
      {draft === null ? (
        <span
          className="inspector-id"
          title={`${id} (doble clic para cambiar el id)`}
          onDoubleClick={() => setDraft(id)}
        >
          {id}
        </span>
      ) : (
        <input
          className="id-input"
          aria-label={`Id de ${id}`}
          value={draft}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          onBlur={() => finish(true)}
        />
      )}
      {error !== null && (
        <p className="recovery-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
