/**
 * El código Typst del documento, en solo lectura.
 *
 * Es **una salida, no una entrada**: el editor genera este código a partir
 * del JSON y nunca lo lee de vuelta (principio 1). Por eso el panel no se
 * puede escribir, y lo dice arriba con todas las letras.
 *
 * - Se actualiza con cada cambio del documento, que es lo que se recompila.
 * - Al seleccionar un elemento, **su trozo de código se marca y se trae a
 *   la vista**. Dónde está cada elemento lo dice el núcleo (`codegen::spans`).
 * - Un botón copia el código entero al portapapeles del sistema.
 */
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, lineNumbers } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

import { type GeneratedCode, generatedCode } from "../commands";
import { useOpenDocument, useSelectedElement } from "../store/document";
import { textIndex } from "../text/caret";
import { typstHighlight } from "./typstHighlight";

/** Marca el trozo del elemento seleccionado. */
const mark = Decoration.mark({ class: "cm-selected-element" });

/** Qué trozo hay que marcar, en bytes del código. */
const setHighlight = StateEffect.define<{ from: number; to: number } | null>();

const highlighted = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let decorations = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setHighlight)) {
        const range = effect.value;
        decorations =
          range === null || range.from >= range.to
            ? Decoration.none
            : Decoration.set([mark.range(range.from, range.to)]);
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function CodePanel() {
  const selected = useSelectedElement();
  // El documento cambia de objeto con cada cambio: eso es lo que hace que
  // el panel se ponga al día.
  const document = useOpenDocument();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [generated, setGenerated] = useState<GeneratedCode | null>(null);
  const [copied, setCopied] = useState(false);

  // El editor se crea una vez y se va rellenando: rehacerlo en cada cambio
  // perdería el desplazamiento.
  useEffect(() => {
    if (host.current === null) {
      return;
    }
    const editor = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          typstHighlight,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          highlighted,
        ],
      }),
      parent: host.current,
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  // El código, cada vez que cambia el documento.
  useEffect(() => {
    let current = true;
    setCopied(false);
    void generatedCode()
      .then((code) => {
        if (current) {
          setGenerated(code);
        }
      })
      .catch(() => {
        if (current) {
          setGenerated(null);
        }
      });
    return () => {
      current = false;
    };
  }, [document]);

  // Lo que se ve: el código, y el trozo del elemento seleccionado.
  useEffect(() => {
    const editor = view.current;
    if (editor === null) {
      return;
    }
    const code = generated?.code ?? "";
    if (editor.state.doc.toString() !== code) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: code } });
    }

    // El núcleo cuenta en bytes y el editor en unidades de JavaScript: con
    // una tilde en el código, quedarse con el byte marcaría otro sitio.
    const span = generated?.spans.find((one) => one.id === selected) ?? null;
    const range =
      span === null
        ? null
        : { from: textIndex(code, span.start), to: textIndex(code, span.end) };
    editor.dispatch({ effects: setHighlight.of(range) });
    if (range !== null) {
      editor.dispatch({ effects: EditorView.scrollIntoView(range.from, { y: "center" }) });
    }
  }, [generated, selected]);

  const copy = () => {
    const code = generated?.code ?? "";
    if (code === "") {
      return;
    }
    void navigator.clipboard
      ?.writeText(code)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  return (
    <div className="code-panel">
      <p className="code-notice">
        Este código lo <strong>genera</strong> Galera a partir del documento. Se enseña para
        leerlo: no se edita, y lo que se escriba aquí no volvería al documento.
      </p>
      <div className="code-actions">
        <button type="button" onClick={copy} disabled={generated === null}>
          {copied ? "Copiado" : "Copiar el código"}
        </button>
      </div>
      <div className="code-editor" ref={host} aria-label="Código Typst generado" role="figure" />
    </div>
  );
}
