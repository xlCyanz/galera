/**
 * Seleccionar con el ratón: del clic en el lienzo al elemento.
 *
 * La interfaz no decide qué hay bajo el puntero (principio 5): pasa el clic a
 * milímetros de la página con `transform.ts` y se lo pregunta al núcleo
 * (`element_at`), que mira las cajas de la compilación que se ve.
 *
 * - Clic: selecciona el elemento de más arriba bajo el puntero.
 * - Clic en una zona vacía: deselecciona.
 * - Alt o ⌘ + clic: atraviesa hacia el elemento que hay debajo del
 *   seleccionado, y del último vuelve al primero.
 *
 * Las respuestas llegan en orden de petición, pero por si no: una respuesta
 * que llega después de otro clic se descarta.
 */
import { type PointerEvent, useRef } from "react";

import { elementAt } from "../commands";
import { useDocumentStore } from "../store/document";
import { type CanvasTransform, toDocument } from "./transform";

/**
 * Cuánto se ensancha cada elemento para acertarlo, en píxeles de pantalla:
 * una línea de grosor cero se acierta igual a cualquier zoom.
 */
export const HIT_TOLERANCE_PX = 4;

/** Si un clic pide atravesar hacia el elemento de abajo. */
export function wantsToGoThrough(event: { altKey: boolean; metaKey: boolean }): boolean {
  return event.altKey || event.metaKey;
}

/**
 * Devuelve el manejador de `pointerdown` para el área del lienzo.
 *
 * @param transform Dónde está la página visible y a qué escala, o `null` si
 *   no hay página.
 * @param page La página visible, contando desde 0.
 */
export function useSelection(
  transform: CanvasTransform | null,
  page: number,
): (event: PointerEvent<HTMLElement>) => void {
  const latest = useRef(0);

  return (event) => {
    // Solo el botón principal, y si nadie lo ha usado ya (desplazar con
    // Espacio o con el botón central).
    if (event.button !== 0 || event.defaultPrevented || transform === null) {
      return;
    }
    const area = event.currentTarget.getBoundingClientRect();
    const point = toDocument(transform, event.clientX - area.left, event.clientY - area.top);
    const tolerance = HIT_TOLERANCE_PX / transform.pxPerMm;
    const { selectedElement, select } = useDocumentStore.getState();
    const below = wantsToGoThrough(event) ? selectedElement : null;

    const request = ++latest.current;
    void elementAt(page, point.x, point.y, tolerance, below)
      .then((id) => {
        if (request === latest.current) {
          select(id);
        }
      })
      .catch(() => {
        // Sin respuesta del núcleo no se cambia la selección.
      });
  };
}
