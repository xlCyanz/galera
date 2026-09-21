/**
 * Aplicar formato a lo que está seleccionado dentro de un texto.
 *
 * Atiende ⌘B, ⌘I y ⌘U —que llegan del registro de atajos y funcionan
 * también mientras se escribe— y da la función que usa la barra flotante.
 * El cambio es un comando del núcleo (`Op::FormatText`), que parte los
 * tramos que toca y junta los que quedan iguales.
 *
 * Sin nada seleccionado no hace nada: el formato se aplica a un tramo, y el
 * de lo que se escriba a continuación es el del tramo de su izquierda.
 */
import { applyOp, errorMessage } from "../commands";
import { useShortcut } from "../hooks/useShortcuts";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import type { Line } from "../types/model";
import type { Format, Op } from "../types/ops";
import { targetOf } from "../store/editing";
import { formatOf, toggle } from "./format";
import { type EditTarget, formatOp, runsOf as runsOfTarget } from "./target";
import { charactersBefore, count, textOf } from "./change";

/**
 * Aplica un cambio de formato a lo que haya seleccionado.
 *
 * Devuelve lo que diga el núcleo si no lo acepta —un enlace que no lleva a
 * la web, por ejemplo—, para poder decirlo; y `null` si salió bien o si no
 * había nada seleccionado.
 */
export async function applyFormat(change: Format): Promise<string | null> {
  const state = useEditingStore.getState();
  const target = targetOf(state);
  const { start, end, marked } = state;
  if (target === null) {
    return null;
  }

  // Con varias celdas marcadas, el formato va al texto entero de todas, y
  // en un solo comando: un cambio, una compilación y un paso del historial.
  const ops =
    target.kind === "cell" && marked.length > 0
      ? wholeCells(target.table, [{ row: target.row, column: target.column }, ...marked], change)
      : selected(target, start, end, change);

  const op = ops.length === 1 ? ops[0] : { op: "batch" as const, ops };
  if (ops.length === 0 || op === undefined) {
    return null;
  }

  try {
    const applied = await applyOp(op);
    useDocumentStore.getState().applyEdit(applied);
    return null;
  } catch (reason: unknown) {
    // El texto se queda como estaba.
    return errorMessage(reason);
  }
}

/**
 * El comando del tramo seleccionado, o ninguno si no hay nada seleccionado.
 *
 * El tramo pasa de bytes —como lo guarda la edición— a caracteres, que es
 * como los cuenta el núcleo.
 */
function selected(target: EditTarget, start: number, end: number, change: Format): Op[] {
  if (start === end) {
    return [];
  }
  const runs = runsOfTarget(useDocumentStore.getState().document, target);
  if (runs === null) {
    return [];
  }
  const text = textOf(runs);
  const from = charactersBefore(text, Math.min(start, end));
  const to = charactersBefore(text, Math.max(start, end));
  return from === to ? [] : [formatOp(target, from, to, change)];
}

/** Un comando por celda, cada uno sobre su texto entero. */
function wholeCells(
  table: string,
  cells: readonly { row: number; column: number }[],
  change: Format,
): Op[] {
  const document = useDocumentStore.getState().document;
  return cells.flatMap((cell) => {
    const runs = runsOfTarget(document, { kind: "cell", table, ...cell });
    if (runs === null) {
      return [];
    }
    const text = textOf(runs);
    // El tramo de un comando va en caracteres, como lo cuenta el núcleo
    // (`model::text`), no en bytes.
    const to = count(text, text.length);
    return to === 0 ? [] : [formatOp({ kind: "cell", table, ...cell }, 0, to, change)];
  });
}

/**
 * Cambia cómo se componen las líneas que toca la selección: hacerlas lista,
 * quitarles la lista o cambiarlas de nivel.
 *
 * Vale también con el cursor suelto: la línea donde está es una línea.
 */
export async function applyLines(style: Line): Promise<string | null> {
  const { element, start, end } = useEditingStore.getState();
  if (element === null) {
    return null;
  }
  // Como en el formato: el comando cuenta en caracteres, no en bytes.
  const runs = runsOfTarget(useDocumentStore.getState().document, { kind: "element", id: element });
  if (runs === null) {
    return null;
  }
  const text = textOf(runs);
  const from = charactersBefore(text, Math.min(start, end));
  const to = charactersBefore(text, Math.max(start, end));
  try {
    const applied = await applyOp({ op: "set_lines", id: element, from, to, line: style });
    useDocumentStore.getState().applyEdit(applied);
    return null;
  } catch (reason: unknown) {
    return errorMessage(reason);
  }
}

/** Registra ⌘B, ⌘I y ⌘U mientras haya un texto abierto. */
export function useTextFormat(): void {
  for (const what of ["bold", "italic", "underline"] as const) {
    // Cada uno se registra por su cuenta: el registro los atiende por id.
    useShortcut(what, () => {
      const state = useEditingStore.getState();
      const target = targetOf(state);
      const { start, end, marked } = state;
      // Con celdas marcadas vale sin selección: el formato es de las celdas
      // enteras.
      if (target === null || (start === end && marked.length === 0)) {
        return false;
      }
      const runs = runsOfTarget(useDocumentStore.getState().document, target);
      if (runs === null) {
        return false;
      }
      void applyFormat(toggle(formatOf(runs, start, end), what));
      return true;
    });
  }
}

/** El texto que se escribe, sea de un bloque o de un flujo, para enseñar
 * su formato. */
export function editedRuns() {
  const target = targetOf(useEditingStore.getState());
  if (target === null) {
    return [];
  }
  return runsOfTarget(useDocumentStore.getState().document, target) ?? [];
}

/** El texto entero del elemento que se escribe. */
export function editedText(): string {
  return textOf(editedRuns());
}
