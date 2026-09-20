/**
 * Entrar a escribir en un texto del lienzo, y señalar dentro de él.
 *
 * - **Doble clic** sobre un bloque de texto entra a escribirlo. Quién hay
 *   bajo el puntero lo dice el núcleo, igual que al seleccionar
 *   (principio 5). Sobre cualquier otro elemento no hace nada.
 * - **Ya dentro**, el puntero coloca el cursor y selecciona: pulsar y
 *   arrastrar elige un tramo, doble clic una palabra, triple clic un
 *   párrafo, y ⇧ + clic estira lo que ya hubiera. Todo eso se resuelve con
 *   las posiciones de los glifos (`selection.ts`), que ya están aquí:
 *   arrastrar no puede ir y volver al backend en cada movimiento.
 * - Pulsar **fuera** del texto que se escribe sale del modo, y el clic sigue
 *   su camino normal por el lienzo.
 *
 * Lo que se elige se guarda en el estado de edición, y el campo invisible
 * se pone al día con ello: así escribir sustituye lo seleccionado y ⌘C
 * copia lo que se ve seleccionado.
 */
import type { MouseEvent, PointerEvent } from "react";
import { useRef } from "react";

import { elementAt } from "../commands";
import { HIT_TOLERANCE_PX } from "../canvas/useSelection";
import { type CanvasTransform, toDocument } from "../canvas/transform";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import { byteIndex } from "./caret";
import { textOf } from "./change";
import { indexAt, paragraphAt, unrotate, wordAt } from "./selection";

/** Cuánto se ensancha la caja del texto para seguir señalando dentro, en
 * mm: pulsar justo en el borde no tendría que salirse. */
const EDGE_MM = 1;

/** Los manejadores que el lienzo necesita para escribir en un texto. */
export interface TextEditing {
  /** Doble clic en el lienzo: entrar a escribir un texto. */
  onDoubleClick: (event: MouseEvent<HTMLElement>) => void;
  /**
   * Pulsar en el lienzo. Devuelve `true` si lo ha atendido —se estaba
   * escribiendo y se ha pulsado dentro del texto—, y entonces el lienzo no
   * hace nada más con ese clic.
   */
  onPointerDown: (event: PointerEvent<HTMLElement>) => boolean;
}

/**
 * @param transform Dónde está la página visible y a qué escala.
 * @param page La página visible, contando desde 0.
 */
export function useTextEditing(transform: CanvasTransform | null, page: number): TextEditing {
  /** Mientras se arrastra para seleccionar: dónde empezó, en bytes. */
  const anchor = useRef<number | null>(null);

  /** El punto del evento en mm de la página. */
  const pointOf = (event: { currentTarget: HTMLElement; clientX: number; clientY: number }) => {
    if (transform === null) {
      return null;
    }
    const area = event.currentTarget.getBoundingClientRect();
    return toDocument(transform, event.clientX - area.left, event.clientY - area.top);
  };

  /** El texto que se está escribiendo y su caja, si el punto cae dentro. */
  const editedAt = (x: number, y: number): { box: LayoutBox; text: string } | null => {
    const { element } = useEditingStore.getState();
    if (element === null) {
      return null;
    }
    const box = useLayoutStore.getState().boxes[element];
    const document = useDocumentStore.getState().document;
    if (box === undefined || document === undefined || document === null) {
      return null;
    }
    const local = unrotate(box, x, y);
    const inside =
      local.x >= box.x - EDGE_MM &&
      local.x <= box.x + box.w + EDGE_MM &&
      local.y >= box.y - EDGE_MM &&
      local.y <= box.y + box.h + EDGE_MM;
    if (!inside) {
      return null;
    }
    const found = document.pages
      .flatMap((one) => one.elements)
      .find((candidate) => candidate.id === element);
    return found !== undefined && found.type === "text"
      ? { box, text: textOf(found.content) }
      : null;
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const view = transform;
    if (event.button !== 0 || view === null) {
      return false;
    }
    const point = pointOf(event);
    if (point === null) {
      return false;
    }
    const edited = editedAt(point.x, point.y);
    if (edited === null) {
      // Fuera del texto: se deja de escribir y el clic sigue su camino.
      useEditingStore.getState().stop();
      return false;
    }

    const { box, text } = edited;
    const { glyphs, start, end } = useEditingStore.getState();
    const local = unrotate(box, point.x, point.y);
    const at = indexAt(glyphs, text, local.x, local.y);
    const select = useEditingStore.getState().select;

    // Tres clics seguidos: el párrafo. Dos: la palabra.
    if (event.detail >= 3) {
      const range = paragraphAt(text, at);
      anchor.current = null;
      select(range.start, range.end);
    } else if (event.detail === 2) {
      const range = wordAt(text, at);
      anchor.current = null;
      select(range.start, range.end);
    } else if (event.shiftKey) {
      // ⇧ estira lo que ya hubiera desde su otro extremo.
      const from = start === end ? start : (at < start ? end : start);
      anchor.current = from;
      select(from, at);
    } else {
      anchor.current = at;
      select(at, at);
    }

    // Arrastrar estira la selección hasta que se suelta. El área se guarda
    // ahora: React vacía el evento en cuanto vuelve el manejador.
    const viewport = event.currentTarget;
    const move = (moved: globalThis.PointerEvent) => {
      const from = anchor.current;
      if (from === null) {
        return;
      }
      const area = viewport.getBoundingClientRect();
      const inCanvas = toDocument(view, moved.clientX - area.left, moved.clientY - area.top);
      const there = unrotate(box, inCanvas.x, inCanvas.y);
      useEditingStore.getState().select(from, indexAt(glyphs, text, there.x, there.y));
    };
    const release = () => {
      anchor.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);

    // El lienzo no tiene que seleccionar ni arrastrar el elemento.
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const onDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || transform === null) {
      return;
    }
    const point = pointOf(event);
    if (point === null || editedAt(point.x, point.y) !== null) {
      // Dentro del texto que ya se escribe lo atendió `onPointerDown`.
      return;
    }
    void elementAt(page, point.x, point.y, HIT_TOLERANCE_PX / transform.pxPerMm, null)
      .then((id) => {
        if (id === null) {
          return;
        }
        const element = useDocumentStore
          .getState()
          .document?.pages.flatMap((one) => one.elements)
          .find((candidate) => candidate.id === id);
        if (element === undefined || element.type !== "text") {
          return;
        }
        useDocumentStore.getState().select(id);
        // El cursor entra al final, contado en bytes como el núcleo.
        const text = textOf(element.content);
        useEditingStore.getState().edit(id, byteIndex(text, text.length));
      })
      .catch(() => {
        // Sin respuesta del núcleo no se entra a escribir.
      });
  };

  return { onDoubleClick, onPointerDown };
}
