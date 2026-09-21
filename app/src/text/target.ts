/**
 * Qué texto se está escribiendo: el de un bloque, el de un flujo o el de
 * una celda de una tabla.
 *
 * Son tres sitios distintos del documento —un elemento lleva su texto; un
 * flujo lo lleva él, y sus zonas solo dicen dónde cabe; una celda lo lleva
 * dentro de su tabla— pero **se escriben igual**: el mismo campo invisible,
 * el mismo cursor y la misma selección. Este módulo es la única parte que
 * sabe de los tres, para que el resto de la edición no tenga que preguntar
 * cuál es cuál.
 *
 * La diferencia que sí se nota está en los glifos: los de un bloque y los
 * de una celda están en una página, y los de un flujo pueden estar en
 * varias, cada uno con la suya (ver `layout::glyphs`).
 */
import { cellGlyphs, flowGlyphs, glyphs as glyphsOf } from "../commands";
import type { Glyph } from "../types/layout";
import type { Document, Line, Run } from "../types/model";
import { cellOf } from "./table";
import type { Format, Op } from "../types/ops";

/** El texto que se escribe: el de un elemento, el de un flujo o el de una
 * celda. */
export type EditTarget =
  | { kind: "element"; id: string }
  | { kind: "flow"; name: string }
  | { kind: "cell"; table: string; row: number; column: number };

/** Cómo se llama, para agrupar los cambios del historial. */
export function keyOf(target: EditTarget): string {
  switch (target.kind) {
    case "element":
      return target.id;
    case "flow":
      return `flujo:${target.name}`;
    default:
      return `celda:${target.table}:${target.row}:${target.column}`;
  }
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
  if (target.kind === "cell") {
    return cellOf(document, target.table, target.row, target.column)?.content ?? null;
  }
  const element = document.pages
    .flatMap((page) => page.elements)
    .find((one) => one.id === target.id);
  return element !== undefined && element.type === "text" ? element.content : null;
}

/**
 * Los estilos de línea del texto que se escribe.
 *
 * Solo los tiene un bloque de texto: el de un flujo y el de una celda se
 * componen seguidos, sin listas.
 */
export function linesOf(document: Document | null | undefined, target: EditTarget): Line[] {
  if (target.kind !== "element" || document === null || document === undefined) {
    return [];
  }
  const element = document.pages
    .flatMap((page) => page.elements)
    .find((one) => one.id === target.id);
  return element !== undefined && element.type === "text" ? (element.lines ?? []) : [];
}

/** El comando que mete texto donde diga. */
export function insertOp(target: EditTarget, at: number, text: string): Op {
  switch (target.kind) {
    case "element":
      return { op: "insert_text", id: target.id, at, text };
    case "flow":
      return { op: "insert_flow_text", flow: target.name, at, text };
    default:
      return {
        op: "insert_cell_text",
        id: target.table,
        row: target.row,
        column: target.column,
        at,
        text,
      };
  }
}

/** El que borra el tramo `[from, to)`. */
export function deleteOp(target: EditTarget, from: number, to: number): Op {
  switch (target.kind) {
    case "element":
      return { op: "delete_text", id: target.id, from, to };
    case "flow":
      return { op: "delete_flow_text", flow: target.name, from, to };
    default:
      return {
        op: "delete_cell_text",
        id: target.table,
        row: target.row,
        column: target.column,
        from,
        to,
      };
  }
}

/** El que le cambia el formato. */
export function formatOp(target: EditTarget, from: number, to: number, format: Format): Op {
  switch (target.kind) {
    case "element":
      return { op: "format_text", id: target.id, from, to, format };
    case "flow":
      return { op: "format_flow_text", flow: target.name, from, to, format };
    default:
      return {
        op: "format_cell_text",
        id: target.table,
        row: target.row,
        column: target.column,
        from,
        to,
        format,
      };
  }
}

/** Dónde quedó cada glifo del texto que se escribe. */
export function glyphsOfTarget(target: EditTarget): Promise<Glyph[]> {
  switch (target.kind) {
    case "element":
      return glyphsOf(target.id);
    case "flow":
      return flowGlyphs(target.name);
    default:
      return cellGlyphs(target.table, target.row, target.column);
  }
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
 * página llevaría el cursor a la zona de al lado. Con una celda pasa lo
 * mismo: las de una fila comparten altura.
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
