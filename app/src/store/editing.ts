/**
 * Qué texto se está escribiendo, y por dónde va el cursor.
 *
 * Editar un texto es un modo del editor, no algo del documento: se entra
 * con doble clic en un bloque de texto y se sale con Escape o pulsando
 * fuera. Mientras dura, el teclado va al campo invisible
 * (`text/HiddenInput.tsx`) y cada cambio se manda como un comando, igual
 * que cualquier otra edición.
 *
 * Aquí solo está el modo, la selección dentro del texto y dónde quedó cada
 * glifo. **El texto no**: ese vive en el documento, que lo lleva el backend
 * (principio 1).
 *
 * La selección se cuenta en **bytes** del texto del elemento, como la
 * cuenta el núcleo: así el cursor (`text/Cursor.tsx`) compara con los
 * glifos sin traducir nada. Quien habla con el campo invisible, que cuenta
 * en unidades de JavaScript, traduce al entrar y al salir (`text/caret.ts`).
 */
import { create } from "zustand";

import type { Glyph } from "../types/layout";

export interface EditingState {
  /** El id del texto que se está escribiendo, o `null`. */
  element: string | null;
  /** Dónde empieza la selección dentro del texto, en bytes. */
  start: number;
  /** Dónde acaba, en bytes. Si es igual a `start`, es el cursor. */
  end: number;
  /** Si el sistema de entrada tiene algo a medias (una tecla muerta, un
   * candidato del IME). Mientras dure no se manda nada al backend. */
  composing: boolean;
  /** Dónde quedó cada glifo del texto que se escribe, según Typst. */
  glyphs: Glyph[];
  /** Cuándo se escribió por última vez: el cursor deja de parpadear al
   * teclear y vuelve a hacerlo al parar. */
  typedAt: number;
  /** Se incrementa cada vez que la selección la cambia algo que no es el
   * campo invisible —el ratón, sobre todo—, para que el campo se ponga al
   * día. */
  selectionRequests: number;

  /**
   * Lo que se ha pedido insertar en el texto desde fuera —una ficha de
   * variable—, con qué trozo sustituye.
   */
  insert: { text: string; from: number; to: number } | null;
  /** Sube con cada petición de insertar, para que el campo la atienda. */
  insertRequests: number;

  /** Entra a escribir en un texto, con el cursor al final. */
  edit: (element: string, at?: number) => void;
  /** Sale del modo de escritura. */
  stop: () => void;
  /** Guarda dónde está la selección dentro del texto. La manda el campo
   * invisible, que es quien la lleva. */
  setSelection: (start: number, end: number) => void;
  /** Cambia la selección desde fuera del campo: el ratón. El campo se pone
   * al día con ella. */
  select: (start: number, end: number) => void;
  /** Dice si hay una composición a medias. */
  setComposing: (composing: boolean) => void;
  /** Guarda dónde quedó cada glifo, de la última compilación. */
  setGlyphs: (glyphs: Glyph[]) => void;
  /** Pide meter ese texto en el que se escribe, entre `from` y `to`. */
  requestInsert: (text: string, from: number, to: number) => void;
  /** Anota que se acaba de escribir. */
  typed: () => void;
}

export const useEditingStore = create<EditingState>()((set) => ({
  element: null,
  start: 0,
  end: 0,
  composing: false,
  glyphs: [],
  typedAt: 0,
  selectionRequests: 0,
  insert: null,
  insertRequests: 0,

  edit: (element, at = 0) =>
    set({ element, start: at, end: at, composing: false, glyphs: [], typedAt: 0 }),
  stop: () => set({ element: null, start: 0, end: 0, composing: false, glyphs: [], typedAt: 0 }),
  setSelection: (start, end) => set({ start, end }),
  select: (start, end) =>
    set((state) => ({ start, end, selectionRequests: state.selectionRequests + 1 })),
  setComposing: (composing) => set({ composing }),
  setGlyphs: (glyphs) => set({ glyphs }),
  typed: () => set({ typedAt: performance.now() }),

  requestInsert: (text, from, to) =>
    set((state) => ({
      insert: { text, from, to },
      insertRequests: state.insertRequests + 1,
    })),
}));

/** El texto que se está escribiendo, o `null`. */
export const useEditingElement = () => useEditingStore((state) => state.element);
