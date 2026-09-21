/**
 * Las cuentas del panel de capas, sin DOM: qué filas hay, cómo se llama
 * cada elemento y a qué posición del arreglo va una fila que se suelta.
 *
 * El arreglo `elements` de una página va **de abajo arriba**: el último es
 * el que se dibuja encima. El panel lo enseña al revés, como los editores
 * de diseño: la primera fila es la capa de arriba.
 */
import type { Element, Page } from "../types/model";

/** Cómo se llama cada tipo de elemento en la interfaz. */
export const ELEMENT_KIND: Record<Element["type"], string> = {
  text: "Texto",
  rect: "Rectángulo",
  ellipse: "Elipse",
  line: "Línea",
  image: "Imagen",
  code: "Código",
  flow: "Zona de texto",
  group: "Grupo",
};

/** Caracteres de un texto que caben en el nombre de su fila. */
const LABEL_LENGTH = 32;

/**
 * Un nombre legible para un elemento: el principio de lo que dice un texto,
 * el recurso de una imagen o el tipo del resto.
 */
export function elementLabel(element: Element): string {
  if (element.type === "text") {
    const text = element.content
      .map((run) => run.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length === 0) {
      return ELEMENT_KIND.text;
    }
    return text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH - 1).trimEnd()}…` : text;
  }
  if (element.type === "image") {
    return element.asset;
  }
  return ELEMENT_KIND[element.type];
}

/** Una fila del panel. */
export interface LayerRow {
  id: string;
  type: Element["type"];
  /** El nombre propio, si se le ha dado, o si no el que se deduce. */
  label: string;
  /** El nombre propio, si lo tiene. */
  name: string | null;
  /** Su posición en el arreglo `elements`. */
  index: number;
  hidden: boolean;
  locked: boolean;
}

/** Las filas de una página, la capa de arriba primero. */
export function layerRows(page: Page): LayerRow[] {
  return page.elements
    .map((element, index) => {
      const name = element.name?.trim() ? element.name : null;
      return {
        id: element.id,
        type: element.type,
        label: name ?? elementLabel(element),
        name,
        index,
        hidden: element.hidden === true,
        locked: element.locked === true,
      };
    })
    .reverse();
}

/**
 * La hendidura entre filas donde caería lo que se suelta en `y`: 0 es
 * encima de la primera fila y `rows.length` debajo de la última.
 *
 * @param rows Dónde está cada fila en pantalla, en orden.
 */
export function gapAt(y: number, rows: ReadonlyArray<{ top: number; bottom: number }>): number {
  return rows.filter((row) => (row.top + row.bottom) / 2 < y).length;
}

/**
 * La posición del arreglo a la que va una capa que está en `from` si se
 * suelta en la hendidura `gap` del panel, o `null` si se queda donde está.
 *
 * Es el `index` de `Op::Reorder`: la posición final en el arreglo.
 *
 * @param count Cuántos elementos tiene la página.
 */
export function reorderIndex(from: number, gap: number, count: number): number | null {
  const shownFrom = count - 1 - from;
  // Al quitar la fila de su sitio, las hendiduras de debajo suben una.
  const shownTo = gap > shownFrom ? gap - 1 : gap;
  const to = count - 1 - Math.max(0, Math.min(count - 1, shownTo));
  return to === from ? null : to;
}
