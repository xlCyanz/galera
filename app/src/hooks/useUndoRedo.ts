/**
 * Deshacer y rehacer desde la interfaz.
 *
 * El historial vive en el backend, junto al documento (principio 1): aquí
 * solo se piden `undo` y `redo`, y lo que vuelve se guarda en el store con
 * `applyEdit`, igual que al aplicar un comando. El store sabe así qué se
 * desharía y qué se reharía, para enseñarlo.
 *
 * Los atajos (⌘Z y ⌘⇧Z; Ctrl en Windows y Linux) se atienden desde el
 * registro (`shortcuts.ts`), que ya los deja pasar de largo mientras se
 * escribe en un campo: ahí deshacer es el del propio campo.
 *
 * Una petición a la vez: si se deja pulsado ⌘Z, las repeticiones que
 * lleguen mientras el backend contesta se ignoran, en vez de acumularse.
 */
import { redo, undo } from "../commands";
import { useShortcut } from "./useShortcuts";
import { type EditHistory, useDocumentStore, useEditHistory } from "../store/document";

/** Si hay una petición al backend sin contestar. */
let pending = false;

/** Lo que se puede pedir al historial. */
export type HistoryCommand = "undo" | "redo";

/** Pide deshacer o rehacer. No hace nada si no hay nada que hacer. */
export async function runHistory(command: HistoryCommand): Promise<void> {
  const store = useDocumentStore.getState();
  if (pending || store.document === null || store.history[command] === null) {
    return;
  }
  pending = true;
  try {
    const applied = await (command === "undo" ? undo() : redo());
    if (applied !== null) {
      useDocumentStore.getState().applyEdit(applied);
    }
  } catch {
    // Si el backend no puede, el documento sigue como estaba.
  } finally {
    pending = false;
  }
}

/**
 * Escucha los atajos del historial y devuelve qué se desharía y qué se
 * reharía ahora.
 */
export function useUndoRedo(): EditHistory {
  useShortcut("undo", () => void runHistory("undo"));
  useShortcut("redo", () => void runHistory("redo"));
  return useEditHistory();
}
