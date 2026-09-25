/**
 * Los comandos que cambian la rejilla de una tabla.
 *
 * Los mismos que usan el inspector y el menú del lienzo: meter y quitar
 * filas y columnas es lo mismo se pida desde donde se pida, y así se
 * describe igual en el historial.
 *
 * Aquí solo se arman los comandos. Quién se encoge al quitar una columna
 * que cruza una celda combinada, o si un rectángulo se puede combinar, lo
 * decide el núcleo (`ops::table`), que es donde vive la lógica
 * (principio 5): si no se puede, lo dice él.
 */
import { grid } from "../text/table";
import type { ColumnWidth, Element, TableRow } from "../types/model";
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

/** Una celda por su sitio en la rejilla. */
export interface GridPlace {
  row: number;
  column: number;
}

/**
 * El rectángulo de la rejilla que contiene esas celdas enteras, contando lo
 * que ocupa cada una si está combinada. `null` si no hay al menos dos
 * celdas que combinar.
 */
export function mergeRegion(
  table: Element & { type: "table" },
  cells: readonly GridPlace[],
): { row: number; column: number; rows: number; columns: number } | null {
  const places = grid(table.columns.length, table.rows);
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;
  const distinct = new Set<string>();
  for (const { row, column } of cells) {
    const index = places[row]?.indexOf(column) ?? -1;
    const cell = index < 0 ? undefined : table.rows[row]?.cells[index];
    if (cell === undefined) {
      continue;
    }
    distinct.add(`${row}:${column}`);
    top = Math.min(top, row);
    left = Math.min(left, column);
    bottom = Math.max(bottom, row + Math.max(cell.rowspan, 1));
    right = Math.max(right, column + Math.max(cell.colspan, 1));
  }
  const rows = bottom - top;
  const columns = right - left;
  // Hacen falta dos celdas: una combinada sola ya es una.
  if (distinct.size < 2) {
    return null;
  }
  return { row: top, column: left, rows, columns };
}

/** Combina un rectángulo de la rejilla en su celda de arriba a la izquierda. */
export function mergeCellsOp(
  table: string,
  region: { row: number; column: number; rows: number; columns: number },
): Op {
  return { op: "merge_cells", id: table, ...region };
}

/** Separa una celda combinada en celdas sueltas. */
export function splitCellOp(table: string, row: number, column: number): Op {
  return { op: "split_cell", id: table, row, column };
}

