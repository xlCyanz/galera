/**
 * Qué texto se está escribiendo: el de un bloque o el de un flujo.
 *
 * Son dos sitios distintos del documento —un elemento lleva su texto; un
 * flujo lo lleva él, y sus zonas solo dicen dónde cabe— pero **se escriben
 * igual**: el mismo campo invisible, el mismo cursor y la misma selección.
 * Este módulo es la única parte que sabe de los dos, para que el resto de
 * la edición no tenga que preguntar cuál es cuál.
 *
 * La diferencia que sí se nota está en los glifos: los de un bloque están
 * en una página y los de un flujo pueden estar en varias, cada uno con la
 * suya (ver `layout::glyphs`).
 */
import { flowGlyphs, glyphs as glyphsOf } from "../commands";
import type { Glyph } from "../types/layout";
import type { Document, Line, Run } from "../types/model";
import type { Format, Op } from "../types/ops";

/** El texto que se escribe: el de un elemento o el de un flujo. */
export type EditTarget = { kind: "element"; id: string } | { kind: "flow"; name: string };

/** Cómo se llama, para agrupar los cambios del historial. */
export function keyOf(target: EditTarget): string {
  return target.kind === "element" ? target.id : `flujo:${target.name}`;
}

/**
 * Los tramos del texto que se escribe, o `null` si ya no está: el elemento
 * se ha borrado, o no es un texto, o el flujo ya no existe.
 */
export function runsOf(document: Document | null | undefined, target: EditTarget): Run[] | null {
  if (document === null || document === undefined) {
    return null;
  }
  if (target.kind === "flow") {
    return document.flows?.[target.name]?.content ?? null;
  }
  const element = document.pages
    .flatMap((page) => page.elements)
    .find((one) => one.id === target.id);
  return element !== undefined && element.type === "text" ? element.content : null;
}

/**
 * Los estilos de línea del texto que se escribe.
 *
 * Un flujo no los tiene: sus listas llegarán con las tablas (F7-04), y
 * hasta entonces su texto se compone seguido.
 */
export function linesOf(document: Document | null | undefined, target: EditTarget): Line[] {
  if (target.kind === "flow" || document === null || document === undefined) {
    return [];
  }
  const element = document.pages
    .flatMap((page) => page.elements)
    .find((one) => one.id === target.id);
  return element !== undefined && element.type === "text" ? (element.lines ?? []) : [];
}

/** El comando que mete texto donde diga. */
export function insertOp(target: EditTarget, at: number, text: string): Op {
  return target.kind === "element"
    ? { op: "insert_text", id: target.id, at, text }
    : { op: "insert_flow_text", flow: target.name, at, text };
}

/** El que borra el tramo `[from, to)`. */
export function deleteOp(target: EditTarget, from: number, to: number): Op {
  return target.kind === "element"
    ? { op: "delete_text", id: target.id, from, to }
    : { op: "delete_flow_text", flow: target.name, from, to };
}

/** El que le cambia el formato. */
export function formatOp(target: EditTarget, from: number, to: number, format: Format): Op {
  return target.kind === "element"
    ? { op: "format_text", id: target.id, from, to, format }
    : { op: "format_flow_text", flow: target.name, from, to, format };
}

/** Dónde quedó cada glifo del texto que se escribe. */
export function glyphsOfTarget(target: EditTarget): Promise<Glyph[]> {
  return target.kind === "element" ? glyphsOf(target.id) : flowGlyphs(target.name);
}

/** Los glifos que quedaron en una página. */
export function onPage(glyphs: readonly Glyph[], page: number): Glyph[] {
  return glyphs.filter((glyph) => glyph.page === page);
}

/**
 * Los glifos que quedaron dentro de una caja de su página.
 *
 * Señalar dentro de un flujo se resuelve zona a zona: dos zonas de la misma
 * página están a la misma altura, así que mirar todos los glifos de la
 * página llevaría el cursor a la zona de al lado.
 */
export function inBox(
  glyphs: readonly Glyph[],
  box: { page: number; x: number; y: number; w: number; h: number },
): Glyph[] {
  return glyphs.filter(
    (glyph) =>
      glyph.page === box.page &&
      glyph.x + glyph.width > box.x &&
      glyph.x < box.x + box.w &&
      glyph.y + glyph.line_height > box.y &&
      glyph.y < box.y + box.h,
  );
}
