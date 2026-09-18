/**
 * Dónde está cada elemento según el documento, en milímetros.
 *
 * Es la caja que declara el modelo, no la que compone Typst: un texto con
 * alto automático (`h: null`) no sabe aquí cuánto ocupa. Las cajas reales
 * llegan con el layout de la Fase 2.
 */
import type { Document, Element } from "../types/model";

/** La caja de un elemento en su página, en mm. */
export interface ElementBounds {
  x: number;
  y: number;
  w: number;
  /** `null` si el alto lo decide Typst al componer. */
  h: number | null;
  /** Grados, en sentido horario, alrededor del centro. */
  rotation: number;
}

/** Un elemento encontrado: su página (desde 0) y su caja. */
export interface FoundElement {
  pageIndex: number;
  box: ElementBounds;
}

/** La caja de un elemento. Una línea ocupa la caja de sus dos extremos. */
export function elementBounds(element: Element): ElementBounds {
  if (element.type === "line") {
    return {
      x: Math.min(element.x, element.x2),
      y: Math.min(element.y, element.y2),
      w: Math.abs(element.x2 - element.x),
      h: Math.abs(element.y2 - element.y),
      rotation: element.rotation,
    };
  }
  return { x: element.x, y: element.y, w: element.w, h: element.h, rotation: element.rotation };
}

/** Busca un elemento por su id en todas las páginas. */
export function findElement(document: Document, id: string): FoundElement | null {
  for (const [pageIndex, page] of document.pages.entries()) {
    const element = page.elements.find((candidate) => candidate.id === id);
    if (element !== undefined) {
      return { pageIndex, box: elementBounds(element) };
    }
  }
  return null;
}
