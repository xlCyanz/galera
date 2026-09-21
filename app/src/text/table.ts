/**
 * Encontrar una celda en la rejilla de una tabla.
 *
 * Una celda se dice por su **fila y su columna de la rejilla**, que es como
 * la nombran el núcleo, el código generado y el layout: la columna cuenta
 * las que tapan las celdas combinadas de más arriba, no la posición de la
 * celda dentro de su fila. Aquí se traduce eso a la celda del documento,
 * que es lo que hace falta para leer su texto y para saber a qué celda se
 * pasa con el tabulador.
 *
 * Lo que mide cada celda no se calcula aquí: lo dice Typst y llega con la
 * compilación (`CellBox`, ver `layout::cells`).
 */
import type { CellBox } from "../types/layout";
import type { Document, Element, TableCell, TableRow } from "../types/model";

/** Una celda de una tabla, con dónde está. */
export interface CellPlace {
  /** La fila, contando desde 0. */
  row: number;
  /** La columna de la rejilla, contando desde 0. */
  column: number;
  /** Su posición dentro de las celdas de su fila. */
  index: number;
}

/** La tabla con ese id, o `null` si no hay tal tabla. */
export function tableOf(
  document: Document | null | undefined,
  id: string,
): (Element & { type: "table" }) | null {
  if (document === null || document === undefined) {
    return null;
  }
  const element = document.pages.flatMap((page) => page.elements).find((one) => one.id === id);
  return element !== undefined && element.type === "table" ? element : null;
}

/**
 * En qué columna de la rejilla cae cada celda: por cada fila, la columna de
 * cada una de sus celdas, en el orden en que están escritas.
 *
 * Cuenta igual que `model::table::grid`: una celda combinada tapa las que
 * quedan debajo y a su derecha, y las tapadas no están escritas.
 */
export function grid(columns: number, rows: readonly TableRow[]): number[][] {
  const covered = Array.from({ length: columns }, () => 0);
  const places: number[][] = [];

  for (const row of rows) {
    let at = 0;
    const row_places: number[] = [];

    for (const cell of row.cells) {
      while (at < columns && (covered[at] ?? 0) > 0) {
        at += 1;
      }
      row_places.push(at);
      if (cell.colspan === 0 || cell.rowspan === 0) {
        continue;
      }
      for (let column = at; column < Math.min(at + cell.colspan, columns); column += 1) {
        covered[column] = cell.rowspan;
      }
      at += cell.colspan;
    }

    places.push(row_places);
    for (let column = 0; column < columns; column += 1) {
      covered[column] = Math.max((covered[column] ?? 0) - 1, 0);
    }
  }

  return places;
}

/** Todas las celdas de la tabla, en el orden en que se componen. */
export function placesOf(table: Element & { type: "table" }): CellPlace[] {
  return grid(table.columns.length, table.rows).flatMap((columns, row) =>
    columns.map((column, index) => ({ row, column, index })),
  );
}

/** La celda que ocupa esa columna de esa fila, o `null` si no la ocupa ninguna. */
export function cellOf(
  document: Document | null | undefined,
  id: string,
  row: number,
  column: number,
): TableCell | null {
  const table = tableOf(document, id);
  if (table === null) {
    return null;
  }
  const index = grid(table.columns.length, table.rows)[row]?.indexOf(column) ?? -1;
  return index < 0 ? null : (table.rows[row]?.cells[index] ?? null);
}

/**
 * La celda siguiente a la que se está escribiendo, para el tabulador: la de
 * su derecha, y al acabar la fila, la primera de la siguiente. Después de la
 * última, la primera, para que tabular dé la vuelta y nunca se quede sin
 * sitio donde ir.
 */
export function nextCell(
  document: Document | null | undefined,
  id: string,
  row: number,
  column: number,
  back = false,
): CellPlace | null {
  const table = tableOf(document, id);
  if (table === null) {
    return null;
  }
  const places = placesOf(table);
  if (places.length === 0) {
    return null;
  }
  const at = places.findIndex((place) => place.row === row && place.column === column);
  if (at < 0) {
    return places[0] ?? null;
  }
  const next = (at + (back ? -1 : 1) + places.length) % places.length;
  return places[next] ?? null;
}

/**
 * La caja de una celda, tal como la compuso Typst, o `null` si esa celda no
 * está en la última compilación.
 */
export function boxOf(
  cells: readonly CellBox[],
  table: string,
  row: number,
  column: number,
): CellBox | null {
  return (
    cells.find(
      (cell) => cell.table === table && cell.row === row && cell.column === column,
    ) ?? null
  );
}

/**
 * La celda que hay en un punto de una página, en mm y **sin girar**: la
 * última gana, que es la que se dibujó encima.
 *
 * El punto viene ya sin girar, como los glifos: la interfaz gira la tabla
 * entera (ver `selection.unrotate`).
 */
export function cellAt(
  cells: readonly CellBox[],
  page: number,
  x: number,
  y: number,
  table?: string,
): CellBox | null {
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const cell = cells[index];
    if (cell === undefined || cell.page !== page) {
      continue;
    }
    if (table !== undefined && cell.table !== table) {
      continue;
    }
    if (x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h) {
      return cell;
    }
  }
  return null;
}
