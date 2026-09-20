/**
 * El título del documento, editable.
 *
 * Se ve en el inspector cuando no hay nada seleccionado, junto a las
 * propiedades de la página. Cambiarlo es un `Op::SetTitle`: entra en el
 * historial como cualquier otro cambio, y es el nombre que proponen
 * «Exportar a PDF…» y «Guardar como .galera…».
 *
 * Enter o salir del campo aplica; Esc descarta. Un título vacío no vale: el
 * núcleo lo rechaza y el campo vuelve al de antes.
 */
import { type KeyboardEvent, useState } from "react";

import { applyOp, errorMessage } from "../commands";
import { useDocumentStore } from "../store/document";

export function TitleField({ title }: { title: string }) {
  // Lo que se está escribiendo; `null` mientras se enseña el título.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = (text: string) => {
    setDraft(null);
    if (text.trim() === title.trim()) {
      setError(null);
      return;
    }
    void applyOp({ op: "set_title", title: text })
      .then((applied) => {
        useDocumentStore.getState().applyEdit(applied);
        setError(null);
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      setError(null);
      event.currentTarget.blur();
    }
  };

  return (
    <div className="title-field">
      <label className="font-select">
        <span>Título</span>
        <input
          aria-label="Título del documento"
          value={draft ?? title}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (draft !== null) {
              commit(event.currentTarget.value);
            }
          }}
        />
      </label>
      {error !== null && (
        <p className="recovery-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
