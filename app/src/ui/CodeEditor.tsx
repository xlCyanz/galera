/**
 * El código de un bloque, editable con CodeMirror.
 *
 * Es **la única parte del documento donde se escribe Typst a mano**, y el
 * editor lo trata como una caja opaca: lo guarda tal cual y se lo pasa a
 * Typst sin interpretarlo (principio 1, con su excepción declarada). Por eso
 * el panel avisa de que **lo que se escriba aquí no se escapa**: un `#` no
 * es un `#`, es código.
 *
 * - Resaltado de Typst (`typstHighlight.ts`), números de línea y cierre
 *   automático de paréntesis y corchetes.
 * - **Lo escrito se aplica solo**, con un retardo prudente desde la última
 *   tecla; al salir del campo, al momento. Cada cambio es un `SetProperty`,
 *   así que entra en el historial y recompila como todo lo demás.
 * - **Los errores de sintaxis se marcan en su línea** mientras se escribe.
 *   Quién está roto y dónde lo dice el núcleo, que se lo pregunta al
 *   analizador de Typst (`galera_core::code`). Lo que falla al evaluar —una
 *   función que no existe— no se ve hasta compilar, y sale en el panel de
 *   problemas señalando este bloque.
 */
import { closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { type Diagnostic as LintDiagnostic, lintGutter, linter } from "@codemirror/lint";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

import { applyOp, checkCode } from "../commands";
import { useDocumentStore } from "../store/document";
import type { CodeError } from "../types/code";
import { typstHighlight } from "./typstHighlight";

/** Cuánto se espera desde la última tecla para aplicar lo escrito, en ms. */
export const APPLY_DELAY_MS = 700;

/** Los errores de ahora, para que el `linter` los pinte. */
const setErrors = StateEffect.define<CodeError[]>();

const errors = StateField.define<CodeError[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setErrors)) {
        return effect.value;
      }
    }
    return value;
  },
});

/** Lo que el núcleo dice que está roto, como marcas de CodeMirror. */
function marks(view: EditorView): LintDiagnostic[] {
  return view.state.field(errors).flatMap((error) => {
    if (error.line > view.state.doc.lines) {
      return [];
    }
    const line = view.state.doc.line(error.line);
    const from = Math.min(line.from + Math.max(error.column - 1, 0), line.to);
    return [
      {
        from,
        to: line.to > from ? line.to : from,
        severity: "error" as const,
        message: [error.message, ...error.hints].join("\n"),
      },
    ];
  });
}

export interface CodeEditorProps {
  /** El bloque de código. */
  id: string;
  /** Su código de ahora, tal como está en el documento. */
  source: string;
}

export function CodeEditor({ id, source }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** Lo último que se ha mandado al núcleo, para no mandarlo dos veces. */
  const sent = useRef(source);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [broken, setBroken] = useState<CodeError[]>([]);

  useEffect(() => {
    if (host.current === null) {
      return;
    }

    const apply = (text: string) => {
      if (text === sent.current) {
        return;
      }
      sent.current = text;
      void applyOp({ op: "set_property", id, property: { name: "source", value: text } })
        .then((applied) => useDocumentStore.getState().applyEdit(applied))
        .catch(() => undefined);
    };

    const editor = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [
          lineNumbers(),
          history(),
          closeBrackets(),
          typstHighlight,
          EditorView.lineWrapping,
          errors,
          lintGutter(),
          linter(marks, { delay: 0 }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // Las teclas son del código: ni atajos de herramienta ni el Esc
          // del lienzo.
          EditorView.domEventHandlers({
            keydown: (event) => {
              event.stopPropagation();
              return false;
            },
            blur: (_, target) => {
              // Al salir del campo se aplica sin esperar.
              if (timer.current !== null) {
                clearTimeout(timer.current);
                timer.current = null;
              }
              apply(target.state.doc.toString());
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }
            const text = update.state.doc.toString();
            // Los errores de sintaxis, según se escribe.
            void checkCode(text)
              .then((found) => {
                setBroken(found);
                view.current?.dispatch({ effects: setErrors.of(found) });
              })
              .catch(() => undefined);
            // Y el cambio, con su retardo.
            if (timer.current !== null) {
              clearTimeout(timer.current);
            }
            timer.current = setTimeout(() => {
              timer.current = null;
              apply(text);
            }, APPLY_DELAY_MS);
          }),
        ],
      }),
      parent: host.current,
    });
    view.current = editor;

    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      editor.destroy();
      view.current = null;
    };
    // Se crea uno por bloque: cambiar de elemento es empezar de nuevo.
  }, [id]);

  // Si el documento cambia por fuera —deshacer, otro panel—, se pone al día.
  useEffect(() => {
    const editor = view.current;
    if (editor === null || source === sent.current) {
      return;
    }
    sent.current = source;
    if (editor.state.doc.toString() !== source) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } });
    }
  }, [source]);

  return (
    <div className="code-editor-block">
      <label className="code-label" htmlFor={`code-${id}`}>
        Código Typst
      </label>
      <div id={`code-${id}`} className="code-editor" ref={host} />
      <p className="code-hint">
        Lo que se escribe aquí es <strong>código</strong>, no texto: no se escapa, y se ejecuta
        tal cual al compilar. Se aplica solo al dejar de escribir.
      </p>
      {broken.length > 0 && (
        <p className="code-broken" role="status">
          {broken.length === 1
            ? `Línea ${broken[0]?.line}: ${broken[0]?.message}`
            : `${broken.length} errores de sintaxis, desde la línea ${broken[0]?.line}`}
        </p>
      )}
    </div>
  );
}
