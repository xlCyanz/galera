/**
 * El panel de variables: los pares nombre/valor que declara el documento.
 *
 * Por ahora solo se declaran y se editan, que es lo que hace falta para
 * escribir el documento; usarlas en plantillas y generar en lote es la
 * Fase 6.
 *
 * Cada cambio es un comando (`SetVariable`, `RenameVariable`,
 * `RemoveVariable`): entra en el historial y se deshace con ⌘Z. Un nombre
 * repetido o con caracteres que no valen lo rechaza el núcleo, y aquí se
 * dice sin cambiar nada.
 */
import { type KeyboardEvent, useState } from "react";

import { applyOp, errorMessage } from "../commands";
import { useDocumentStore, useOpenDocument } from "../store/document";
import type { Op } from "../types/ops";

export function VariablesPanel() {
  const document = useOpenDocument();
  const [message, setMessage] = useState<string | null>(null);
  // La fila que se está renombrando, y lo escrito.
  const [renaming, setRenaming] = useState<{ name: string; text: string } | null>(null);
  // El nombre de la variable nueva, mientras se escribe.
  const [adding, setAdding] = useState<string | null>(null);

  if (document === null) {
    return null;
  }
  const variables = Object.entries(document.variables);

  const run = (op: Op, done?: () => void) => {
    applyOp(op)
      .then((applied) => {
        useDocumentStore.getState().applyEdit(applied);
        setMessage(null);
        done?.();
      })
      .catch((reason: unknown) => setMessage(errorMessage(reason)));
  };

  const finishRenaming = (commit: boolean) => {
    if (renaming === null) {
      return;
    }
    const to = renaming.text.trim();
    const from = renaming.name;
    setRenaming(null);
    if (commit && to !== "" && to !== from) {
      run({ op: "rename_variable", from, to });
    }
  };

  const finishAdding = (commit: boolean) => {
    const name = adding?.trim() ?? "";
    setAdding(null);
    if (commit && name !== "") {
      run({ op: "set_variable", name, value: "" });
    }
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>, commit: () => void, cancel: () => void) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <section className="assets-panel" aria-label="Variables">
      <div className="assets-header">
        <h2>Variables</h2>
        <button type="button" onClick={() => setAdding("")}>
          Añadir…
        </button>
      </div>
      {message !== null && (
        <p className="assets-message" role="alert">
          {message}
        </p>
      )}
      {variables.length === 0 && adding === null ? (
        <p className="layers-empty">El documento no tiene variables.</p>
      ) : (
        <ul className="variables">
          {variables.map(([name, value]) => (
            <li key={name} className="variable" data-variable={name}>
              {renaming?.name === name ? (
                <input
                  className="variable-name"
                  aria-label={`Nombre de ${name}`}
                  value={renaming.text}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setRenaming({ name, text: event.currentTarget.value })}
                  onKeyDown={(event) => onKey(event, () => finishRenaming(true), () => setRenaming(null))}
                  onBlur={() => finishRenaming(true)}
                />
              ) : (
                <span
                  className="variable-name"
                  title={`${name} (doble clic para renombrar)`}
                  onDoubleClick={() => setRenaming({ name, text: name })}
                >
                  {name}
                </span>
              )}
              <input
                className="variable-value"
                aria-label={`Valor de ${name}`}
                defaultValue={value}
                key={`${name}:${value}`}
                onKeyDown={(event) =>
                  onKey(
                    event,
                    () => event.currentTarget.blur(),
                    () => {
                      event.currentTarget.value = value;
                      event.currentTarget.blur();
                    },
                  )
                }
                onBlur={(event) => {
                  if (event.currentTarget.value !== value) {
                    run({ op: "set_variable", name, value: event.currentTarget.value });
                  }
                }}
              />
              <button
                type="button"
                className="asset-remove"
                aria-label={`Quitar ${name}`}
                title="Quitar del documento"
                onClick={() => run({ op: "remove_variable", name })}
              >
                ×
              </button>
            </li>
          ))}
          {adding !== null && (
            <li className="variable">
              <input
                className="variable-name"
                aria-label="Nombre de la variable nueva"
                placeholder="nombre"
                value={adding}
                autoFocus
                onChange={(event) => setAdding(event.currentTarget.value)}
                onKeyDown={(event) => onKey(event, () => finishAdding(true), () => setAdding(null))}
                onBlur={() => finishAdding(true)}
              />
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
