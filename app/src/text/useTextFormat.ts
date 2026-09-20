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
import { applyOp } from "../commands";
import { useShortcut } from "../hooks/useShortcuts";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import type { Format } from "../types/ops";
import { formatOf, toggle } from "./format";
import { textOf } from "./change";

/** Aplica un cambio de formato a lo que haya seleccionado. */
export function applyFormat(change: Format): void {
  const { element, start, end } = useEditingStore.getState();
  if (element === null || start === end) {
    return;
  }
  const [from, to] = start <= end ? [start, end] : [end, start];
  void applyOp({ op: "format_text", id: element, from, to, format: change })
    .then((applied) => useDocumentStore.getState().applyEdit(applied))
    .catch(() => {
      // Si el núcleo no lo acepta, el texto se queda como estaba.
    });
}

/** Registra ⌘B, ⌘I y ⌘U mientras haya un texto abierto. */
export function useTextFormat(): void {
  for (const what of ["bold", "italic", "underline"] as const) {
    // Cada uno se registra por su cuenta: el registro los atiende por id.
    useShortcut(what, () => {
      const { element, start, end } = useEditingStore.getState();
      if (element === null || start === end) {
        return false;
      }
      const document = useDocumentStore.getState().document;
      const found = document?.pages
        .flatMap((page) => page.elements)
        .find((candidate) => candidate.id === element);
      if (found === undefined || found.type !== "text") {
        return false;
      }
      applyFormat(toggle(formatOf(found.content, start, end), what));
      return true;
    });
  }
}

/** El texto del elemento que se escribe, para enseñar su formato. */
export function editedRuns(): ReturnType<typeof runsOf> {
  return runsOf(useEditingStore.getState().element);
}

function runsOf(id: string | null) {
  if (id === null) {
    return [];
  }
  const found = useDocumentStore
    .getState()
    .document?.pages.flatMap((page) => page.elements)
    .find((candidate) => candidate.id === id);
  return found !== undefined && found.type === "text" ? found.content : [];
}

/** El texto entero del elemento que se escribe. */
export function editedText(): string {
  return textOf(editedRuns());
}
