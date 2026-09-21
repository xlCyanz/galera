/**
 * Los comandos que cambian la rejilla de una tabla.
 *
 * Los mismos que usan el inspector y el menú del lienzo: meter y quitar
 * filas y columnas es lo mismo se pida desde donde se pida, y así se
 * describe igual en el historial.
 *
 * Aquí solo se arman los comandos. Quién se encoge al quitar una columna
 * que cruza una celda combinada lo decide el núcleo (`ops::table`), que es
 * donde vive la lógica (principio 5).
 */
import type { ColumnWidth, TableRow } from "../types/model";
import type { Op } from "../types/ops";

/** Una fila vacía de tantas celdas como columnas tenga la tabla. */
export function emptyRow(columns: number): TableRow {
  return {
    cells: Array.from({ length: Math.max(columns, 1) }, () => ({
      content: [],
      colspan: 1,
      rowspan: 1,
    })),
  };
}

/** Mete una fila vacía en esa posición. */
export function insertRowOp(table: string, columns: number, index: number): Op {
  return { op: "insert_table_row", id: table, index, row: emptyRow(columns) };
}

/** Quita esa fila. */
export function removeRowOp(table: string, index: number): Op {
  return { op: "remove_table_row", id: table, index };
}

/**
 * Mete una columna en esa posición, del mismo ancho que la que estaba ahí,
 * o automática si la tabla no tenía ninguna.
 */
export function insertColumnOp(
  table: string,
  index: number,
  like: ColumnWidth | undefined,
): Op {
  return {
    op: "insert_table_column",
    id: table,
    index,
    width: like ?? { width: "auto" },
  };
}

/** Quita esa columna. */
export function removeColumnOp(table: string, index: number): Op {
  return { op: "remove_table_column", id: table, index };
}

/** Cambia lo que mide una columna. */
export function columnWidthOp(table: string, column: number, width: ColumnWidth): Op {
  return { op: "set_column_width", id: table, column, width };
}
