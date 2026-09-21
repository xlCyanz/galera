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
import type { Format } from "../types/ops";
import { targetOf } from "../store/editing";
import { formatOf, toggle } from "./format";
import { formatOp, runsOf as runsOfTarget } from "./target";
import { textOf } from "./change";

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
  const { start, end } = state;
  if (target === null || start === end) {
    return null;
  }
  const [from, to] = start <= end ? [start, end] : [end, start];
  try {
    const applied = await applyOp(formatOp(target, from, to, change));
    useDocumentStore.getState().applyEdit(applied);
    return null;
  } catch (reason: unknown) {
    // El texto se queda como estaba.
    return errorMessage(reason);
  }
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
  const [from, to] = start <= end ? [start, end] : [end, start];
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
      const { start, end } = state;
      if (target === null || start === end) {
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
