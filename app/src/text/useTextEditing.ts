/**
 * Entrar a escribir en un texto del lienzo.
 *
 * Doble clic sobre un bloque de texto: quién hay bajo el puntero lo dice el
 * núcleo, igual que al seleccionar (principio 5), y si es un texto se entra
 * en el modo de escritura (`store/editing.ts`). Sobre cualquier otro
 * elemento, el doble clic no hace nada.
 *
 * Colocar el cursor donde se pulsó llega con F4-07 (#61): por ahora se
 * entra con el cursor al final.
 */
import type { MouseEvent } from "react";

import { elementAt } from "../commands";
import { HIT_TOLERANCE_PX } from "../canvas/useSelection";
import { type CanvasTransform, toDocument } from "../canvas/transform";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import { textOf } from "./change";

/**
 * Devuelve el manejador de `dblclick` del área del lienzo.
 *
 * @param transform Dónde está la página visible y a qué escala.
 * @param page La página visible, contando desde 0.
 */
export function useTextEditing(
  transform: CanvasTransform | null,
  page: number,
): (event: MouseEvent<HTMLElement>) => void {
  return (event) => {
    if (event.button !== 0 || transform === null) {
      return;
    }
    const area = event.currentTarget.getBoundingClientRect();
    const point = toDocument(transform, event.clientX - area.left, event.clientY - area.top);
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
        useEditingStore.getState().edit(id, textOf(element.content).length);
      })
      .catch(() => {
        // Sin respuesta del núcleo no se entra a escribir.
      });
  };
}
