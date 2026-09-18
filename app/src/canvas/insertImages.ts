/**
 * Los elementos de imagen que se crean al insertar imágenes, sin DOM.
 *
 * Cada imagen nace con un ancho por defecto y el alto a `null`: Typst lo
 * saca de la proporción original del archivo. Si se insertan varias a la
 * vez, cada una va un poco más abajo y a la derecha que la anterior, para
 * que no queden tapadas.
 */
import type { ImageAsset } from "../commands";
import type { Document, Element } from "../types/model";
import { newElementId } from "./createGeometry";
import { roundMm } from "./dragGeometry";

/** Ancho de una imagen nueva, en mm. */
export const DEFAULT_IMAGE_WIDTH_MM = 60;

/** Lo más estrecha que se crea una imagen, en mm. */
export const MIN_IMAGE_WIDTH_MM = 10;

/** Cuánto se desplaza cada imagen respecto a la anterior, en mm. */
export const CASCADE_MM = 5;

/**
 * Los elementos para `images`, empezando en `at` (la esquina superior
 * izquierda de la primera).
 *
 * @param pageWidth El ancho de la página, en mm: una imagen no se crea más
 *   ancha que lo que queda hasta el borde derecho.
 */
export function imageElements(
  document: Document,
  images: readonly ImageAsset[],
  at: { x: number; y: number },
  pageWidth: number,
): Element[] {
  const elements: Element[] = [];
  // Los ids se eligen viendo también los que se acaban de elegir.
  let taken = document;
  for (const [index, image] of images.entries()) {
    const x = roundMm(at.x + index * CASCADE_MM);
    const y = roundMm(at.y + index * CASCADE_MM);
    const room = pageWidth - x;
    const w = roundMm(Math.max(MIN_IMAGE_WIDTH_MM, Math.min(DEFAULT_IMAGE_WIDTH_MM, room)));
    const id = newElementId(taken, "image");
    const element: Element = { type: "image", id, x, y, w, h: null, rotation: 0, asset: image.key };
    elements.push(element);
    taken = { ...taken, pages: [...taken.pages, { id: "", size: { width: 0, height: 0, unit: "mm" }, elements: [element] }] };
  }
  return elements;
}
