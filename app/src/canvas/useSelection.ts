/**
 * Seleccionar con el ratón: del clic en el lienzo al elemento.
 *
 * La interfaz no decide qué hay bajo el puntero (principio 5): pasa el clic a
 * milímetros de la página con `transform.ts` y se lo pregunta al núcleo
 * (`element_at`), que mira las cajas de la compilación que se ve.
 *
 * - Clic: selecciona el elemento de más arriba bajo el puntero.
 * - Clic en una zona vacía: deselecciona, y arrastrar desde ahí dibuja el
 *   rectángulo de selección (`useMarquee.ts`).
 * - ⇧ + clic: añade el elemento a la selección, o lo quita si ya estaba.
 * - Clic sobre algo que ya está seleccionado con más cosas: no cambia la
 *   selección, para poder arrastrar el grupo entero.
 * - Alt o ⌘ + clic: atraviesa hacia el elemento que hay debajo del
 *   seleccionado, y del último vuelve al primero.
 *
 * Las respuestas llegan en orden de petición, pero por si no: una respuesta
 * que llega después de otro clic se descarta.
 *
 * Si el botón sigue pulsado cuando llega la respuesta, se empieza a
 * arrastrar lo que haya seleccionado desde donde se pulsó: pulsar y
 * arrastrar un elemento sin seleccionar lo selecciona y lo mueve de una vez.
 */
import { type PointerEvent, useEffect, useRef } from "react";

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
 * @param onPressed Si el botón sigue pulsado al saber qué elemento es: lo
 *   que queda seleccionado y el punto de la pantalla donde se pulsó.
 * @param onEmpty Si se pulsó donde no hay nada: el punto de la pantalla y si
 *   se pedía sumar a la selección (⇧).
 */
export function useSelection(
  transform: CanvasTransform | null,
  page: number,
  onPressed?: (ids: string[], clientX: number, clientY: number) => void,
  onEmpty?: (clientX: number, clientY: number, additive: boolean) => void,
): (event: PointerEvent<HTMLElement>) => void {
  const latest = useRef(0);
  const pressed = useRef(false);

  useEffect(() => {
    const release = () => {
      pressed.current = false;
    };
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  }, []);

  return (event) => {
    // Solo el botón principal, y si nadie lo ha usado ya (desplazar con
    // Espacio o con el botón central).
    if (event.button !== 0 || event.defaultPrevented || transform === null) {
      return;
    }
    const area = event.currentTarget.getBoundingClientRect();
    const point = toDocument(transform, event.clientX - area.left, event.clientY - area.top);
    const tolerance = HIT_TOLERANCE_PX / transform.pxPerMm;
    const { selection, select, toggleSelected } = useDocumentStore.getState();
    // Atravesar solo tiene sentido con un único elemento debajo.
    const below = wantsToGoThrough(event) && selection.length === 1 ? (selection[0] ?? null) : null;

    const request = ++latest.current;
    const { clientX, clientY, shiftKey } = event;
    pressed.current = true;
    void elementAt(page, point.x, point.y, tolerance, below)
      .then((id) => {
        if (request !== latest.current) {
          return;
        }
        if (id === null) {
          // En vacío: se deselecciona, salvo que se esté sumando con ⇧.
          if (!shiftKey) {
            select(null);
          }
          if (pressed.current) {
            onEmpty?.(clientX, clientY, shiftKey);
          }
          return;
        }
        if (shiftKey) {
          toggleSelected(id);
          return;
        }
        // Pulsar dentro de una selección de varios la deja como está: lo
        // que se quiere es arrastrarla entera.
        if (!selection.includes(id) || selection.length === 1) {
          select(id);
        }
        const now = useDocumentStore.getState().selection;
        if (pressed.current && now.length > 0) {
          onPressed?.([...now], clientX, clientY);
        }
      })
      .catch(() => {
        // Sin respuesta del núcleo no se cambia la selección.
      });
  };
}
