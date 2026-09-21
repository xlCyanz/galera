import { describe, expect, it } from "vitest";

import type { CellBox } from "../types/layout";
import type { Document } from "../types/model";
import { boxOf, cellAt, cellOf, grid, nextCell, placesOf, tableOf } from "./table";

/**
 * La misma tabla que prueba el núcleo: «Enero» ocupa dos filas y «Febrero»,
 * dos columnas.
 *
 * ```text
 * ┌───────┬───────┬───────┐
 * │ Enero │ Norte │  12   │
 * ├───────┼───────┴───────┤
 * │       │ Febrero       │
 * ├───────┼───────┬───────┤
 * │ Marzo │ Sur   │  34   │
 * └───────┴───────┴───────┘
 * ```
 */
const cell = (text: string, spans: { colspan?: number; rowspan?: number } = {}) => ({
  content: [{ text, bold: false, italic: false, underline: false }],
  colspan: spans.colspan ?? 1,
  rowspan: spans.rowspan ?? 1,
});

const document: Document = {
  version: 1,
  meta: { title: "x" },
  fonts: [],
  assets: {},
  variables: {},
  flows: {},
  pages: [
    {
      id: "p1",
      size: { width: 200, height: 100, unit: "mm" },
      elements: [
        {
          type: "table",
          id: "tb1",
          x: 10,
          y: 10,
          w: 100,
          h: null,
          rotation: 0,
          columns: [{ width: "auto" }, { width: "auto" }, { width: "auto" }],
          rows: [
            { cells: [cell("Enero", { rowspan: 2 }), cell("Norte"), cell("12")] },
            { cells: [cell("Febrero", { colspan: 2 })] },
            { cells: [cell("Marzo"), cell("Sur"), cell("34")] },
          ],
          style: { font: "Inter", size: 10, color: "#000000", align: "left", leading: 0.65 },
          inset: 2,
        },
      ],
    },
  ],
};

const box = (row: number, column: number, x: number, y: number): CellBox => ({
  table: "tb1",
  page: 0,
  row,
  column,
  colspan: 1,
  rowspan: 1,
  x,
  y,
  w: 20,
  h: 10,
});

describe("la rejilla de una tabla", () => {
  /** El criterio de la tarea: la celda se dice por su sitio en la rejilla. */
  it("cuenta las columnas que tapan las celdas combinadas", () => {
    const table = tableOf(document, "tb1");
    expect(table).not.toBeNull();
    expect(grid(3, table!.rows)).toEqual([
      [0, 1, 2],
      // La primera columna la tapa «Enero», así que «Febrero» empieza en la
      // segunda.
      [1],
      [0, 1, 2],
    ]);
  });

  it("saca el texto de la celda que ocupa esa columna", () => {
    expect(cellOf(document, "tb1", 0, 0)?.content[0]?.text).toBe("Enero");
    expect(cellOf(document, "tb1", 1, 1)?.content[0]?.text).toBe("Febrero");
    // Esa columna la tapa «Enero»: ahí no empieza ninguna celda.
    expect(cellOf(document, "tb1", 1, 0)).toBeNull();
    expect(cellOf(document, "tb1", 9, 0)).toBeNull();
    expect(cellOf(document, "nada", 0, 0)).toBeNull();
  });

  it("las celdas van en el orden en que se componen", () => {
    const table = tableOf(document, "tb1")!;
    expect(placesOf(table).map((place) => [place.row, place.column])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
  });

  /** El criterio de la tarea: el tabulador pasa a la celda siguiente. */
  it("el tabulador va a la de la derecha y luego a la fila siguiente", () => {
    expect(nextCell(document, "tb1", 0, 0)).toMatchObject({ row: 0, column: 1 });
    // Detrás de la última de la fila viene la única de la de debajo.
    expect(nextCell(document, "tb1", 0, 2)).toMatchObject({ row: 1, column: 1 });
    expect(nextCell(document, "tb1", 1, 1, true)).toMatchObject({ row: 0, column: 2 });
    // Y al final da la vuelta, para no quedarse sin sitio donde ir.
    expect(nextCell(document, "tb1", 2, 2)).toMatchObject({ row: 0, column: 0 });
    expect(nextCell(document, "tb1", 0, 0, true)).toMatchObject({ row: 2, column: 2 });
    expect(nextCell(document, "nada", 0, 0)).toBeNull();
  });
});

describe("dónde quedó cada celda", () => {
  const cells = [box(0, 0, 10, 10), box(0, 1, 30, 10), box(1, 0, 10, 20)];

  it("la caja de una celda es la que midió Typst", () => {
    expect(boxOf(cells, "tb1", 0, 1)?.x).toBe(30);
    expect(boxOf(cells, "tb1", 5, 5)).toBeNull();
  });

  it("un punto cae en la celda que se dibujó ahí", () => {
    expect(cellAt(cells, 0, 31, 12)).toMatchObject({ row: 0, column: 1 });
    expect(cellAt(cells, 0, 11, 22)).toMatchObject({ row: 1, column: 0 });
    expect(cellAt(cells, 0, 80, 12)).toBeNull();
    expect(cellAt(cells, 1, 31, 12)).toBeNull();
    // Y de otra tabla, ninguna.
    expect(cellAt(cells, 0, 31, 12, "otra")).toBeNull();
  });
});
