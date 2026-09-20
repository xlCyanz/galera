/**
 * El código de un bloque de código, editable.
 *
 * Es una **caja opaca**: la app no lo interpreta, lo pasa tal cual a Typst
 * (principio 1, con su excepción declarada). Aquí solo se escribe y se
 * manda con `SetProperty`, así que entra en el historial como todo lo demás.
 *
 * Si lo escrito no compila, el documento **no se rompe**: el lienzo sigue
 * enseñando la última compilación buena y el error sale en el panel de
 * errores, señalando este elemento. El panel de código completo, con
 * resaltado y ayuda, es F5-12.
 */
import { type KeyboardEvent, useState } from "react";

import { applyOp } from "../commands";
import { useDocumentStore } from "../store/document";
import { isMac, shortcutLabel } from "../shortcuts";

const mac = isMac();

export interface CodeInspectorProps {
  /** El bloque de código. */
  id: string;
  /** Su código de ahora. */
  source: string;
}

export function CodeInspector({ id, source }: CodeInspectorProps) {
  // Lo que se está escribiendo; `null` mientras se enseña lo guardado.
  const [draft, setDraft] = useState<string | null>(null);
  const pending = draft !== null && draft !== source;

  const commit = (text: string) => {
    setDraft(null);
    if (text === source) {
      return;
    }
    void applyOp({ op: "set_property", id, property: { name: "source", value: text } })
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Las teclas son del código: ni atajos de herramienta ni Esc del lienzo.
    event.stopPropagation();
    const modifier = mac ? event.metaKey : event.ctrlKey;
    if (event.key === "Enter" && modifier) {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      event.currentTarget.blur();
    }
  };

  return (
    <div className="code-inspector">
      <label className="code-label" htmlFor={`code-${id}`}>
        Código Typst
      </label>
      <textarea
        id={`code-${id}`}
        aria-label="Código Typst"
        spellCheck={false}
        rows={5}
        value={draft ?? source}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (draft !== null) {
            commit(event.currentTarget.value);
          }
        }}
      />
      <p className="code-hint">
        {pending
          ? `Sin aplicar: ${mac ? "⌘" : "Ctrl"}↵ o salir del campo`
          : `Se aplica al salir del campo o con ${mac ? "⌘" : "Ctrl"}↵`}
        . Deshacer con {shortcutLabel("undo", mac)}.
      </p>
    </div>
  );
}
