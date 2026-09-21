/**
 * Las fichas de variable dentro de un texto, sin DOM.
 *
 * Una ficha es `{{nombre}}` escrito en el texto del documento. En la página
 * se ve **el valor** —lo sustituye el núcleo al generar el código—, y aquí
 * se trata como **una sola pieza**: el cursor no se mete dentro, las flechas
 * la saltan entera y borrar la quita de una vez.
 *
 * Las posiciones son las del campo invisible, en unidades de JavaScript, que
 * es lo que usa el `textarea`.
 */

/** Una ficha encontrada en el texto. */
export interface Chip {
  /** El nombre de la variable. */
  name: string;
  /** Dónde empieza `{{`. */
  from: number;
  /** Dónde acaba, detrás de `}}`. */
  to: number;
}

/** Los caracteres que puede llevar el nombre de una variable. */
const NAME = /^[A-Za-z0-9_-]+$/;

/** La ficha que empieza justo en `at`, si hay una. */
export function chipAt(text: string, at: number): Chip | null {
  if (!text.startsWith("{{", at)) {
    return null;
  }
  const end = text.indexOf("}}", at + 2);
  if (end === -1) {
    return null;
  }
  const name = text.slice(at + 2, end);
  return NAME.test(name) ? { name, from: at, to: end + 2 } : null;
}

/** La ficha que acaba justo en `at`, si la hay. */
export function chipBefore(text: string, at: number): Chip | null {
  if (!text.endsWith("}}", at)) {
    return null;
  }
  // Se busca hacia atrás el `{{` más cercano: el nombre no lleva llaves.
  const open = text.lastIndexOf("{{", at - 2);
  if (open === -1) {
    return null;
  }
  const chip = chipAt(text, open);
  return chip !== null && chip.to === at ? chip : null;
}

/** La ficha que empieza en `at` o más adelante y contiene esa posición. */
export function chipAround(text: string, at: number): Chip | null {
  const open = text.lastIndexOf("{{", at);
  if (open === -1) {
    return null;
  }
  const chip = chipAt(text, open);
  return chip !== null && at > chip.from && at < chip.to ? chip : null;
}

/**
 * Lo que se está escribiendo tras un `{{` recién abierto, si el cursor está
 * ahí: el trozo de nombre tecleado y dónde empieza la ficha.
 *
 * Sirve para enseñar la lista de variables mientras se escribe. Un `{{` que
 * ya está cerrado no cuenta: eso es una ficha hecha.
 */
export function openChip(text: string, at: number): { prefix: string; from: number } | null {
  const open = text.lastIndexOf("{{", Math.max(at - 2, 0));
  if (open === -1 || open + 2 > at) {
    return null;
  }
  const prefix = text.slice(open + 2, at);
  if (prefix !== "" && !NAME.test(prefix)) {
    return null;
  }
  // Si ya hay un cierre entre medias, lo de delante no está abierto.
  return text.slice(open + 2, at).includes("}}") ? null : { prefix, from: open };
}

/**
 * El texto con una ficha puesta: sustituye lo que hubiera entre `from` y
 * `to` por `{{nombre}}`, y dice dónde queda el cursor.
 */
export function withChip(
  text: string,
  from: number,
  to: number,
  name: string,
): { text: string; at: number } {
  const chip = `{{${name}}}`;
  return {
    text: text.slice(0, from) + chip + text.slice(to),
    at: from + chip.length,
  };
}

/**
 * Qué hay que borrar con Retroceso o Supr si al lado hay una ficha: el
 * trozo entero. `null` si no hay ninguna ficha pegada al cursor, y entonces
 * borra el campo como siempre.
 */
export function deletion(
  text: string,
  start: number,
  end: number,
  direction: "backward" | "forward",
): { from: number; to: number } | null {
  if (start !== end) {
    return null;
  }
  const chip = direction === "backward" ? chipBefore(text, start) : chipAt(text, start);
  return chip === null ? null : { from: chip.from, to: chip.to };
}

/**
 * Dónde va el cursor al pulsar una flecha si al lado hay una ficha: al otro
 * extremo, saltándola entera. `null` si no hay ficha que saltar.
 */
export function arrow(text: string, at: number, direction: -1 | 1): number | null {
  const chip = direction === -1 ? chipBefore(text, at) : chipAt(text, at);
  if (chip !== null) {
    return direction === -1 ? chip.from : chip.to;
  }
  // Y si el cursor hubiera quedado dentro de una, se sale por su lado.
  const inside = chipAround(text, at);
  return inside === null ? null : direction === -1 ? inside.from : inside.to;
}
