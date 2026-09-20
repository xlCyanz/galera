/**
 * Qué texto se está escribiendo, y por dónde va el cursor.
 *
 * Editar un texto es un modo del editor, no algo del documento: se entra
 * con doble clic en un bloque de texto y se sale con Escape o pulsando
 * fuera. Mientras dura, el teclado va al campo invisible
 * (`text/HiddenInput.tsx`) y cada cambio se manda como un comando, igual
 * que cualquier otra edición.
 *
 * Aquí solo está el modo y la selección dentro del texto. **El texto no**:
 * ese vive en el documento, que lo lleva el backend (principio 1). La
 * selección va en unidades de JavaScript (UTF-16), como la cuenta el campo;
 * sobre ella dibujará el cursor F4-06 (#60).
 */
import { create } from "zustand";

export interface EditingState {
  /** El id del texto que se está escribiendo, o `null`. */
  element: string | null;
  /** Dónde empieza la selección dentro del texto. */
  start: number;
  /** Dónde acaba. Si es igual a `start`, es el cursor. */
  end: number;
  /** Si el sistema de entrada tiene algo a medias (una tecla muerta, un
   * candidato del IME). Mientras dure no se manda nada al backend. */
  composing: boolean;

  /** Entra a escribir en un texto, con el cursor al final. */
  edit: (element: string, at?: number) => void;
  /** Sale del modo de escritura. */
  stop: () => void;
  /** Guarda dónde está la selección dentro del texto. */
  setSelection: (start: number, end: number) => void;
  /** Dice si hay una composición a medias. */
  setComposing: (composing: boolean) => void;
}

export const useEditingStore = create<EditingState>()((set) => ({
  element: null,
  start: 0,
  end: 0,
  composing: false,

  edit: (element, at = 0) => set({ element, start: at, end: at, composing: false }),
  stop: () => set({ element: null, start: 0, end: 0, composing: false }),
  setSelection: (start, end) => set({ start, end }),
  setComposing: (composing) => set({ composing }),
}));

/** El texto que se está escribiendo, o `null`. */
export const useEditingElement = () => useEditingStore((state) => state.element);
