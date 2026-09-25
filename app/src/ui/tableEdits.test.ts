import { describe, expect, it } from "vitest";

import type { Element, TableCell } from "../types/model";
import { mergeCellsOp, mergeRegion, splitCellOp } from "./tableEdits";

const cell = (text: string, span: Partial<TableCell> = {}): TableCell => ({
  content: [{ text, bold: false, italic: false, underline: false }],
  colspan: 1,
  rowspan: 1,
  ...span,
});

/**
 * ```text
 * ┌───────┬───────┬───────┐
 * │ Enero │ Norte │  12   │
 * ├───────┼───────┴───────┤
 * │       │ Febrero       │   «Enero» ocupa dos filas
 * ├───────┼───────┬───────┤
 * │ Marzo │ Sur   │  34   │
 * └───────┴───────┴───────┘
 * ```
 */
const table = {
  type: "table",
  id: "tb1",
  x: 0,
  y: 0,
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
} as Extract<Element, { type: "table" }>;

describe("el rectángulo que se combina", () => {
  it("contiene las celdas enteras, contando lo que ocupan las combinadas", () => {
    expect(mergeRegion(table, [{ row: 2, column: 1 }, { row: 2, column: 2 }])).toEqual({ row: 2, column: 1, rows: 1, columns: 2 });
    // «Febrero» ocupa dos columnas: el rectángulo llega hasta la tercera.
    expect(mergeRegion(table, [{ row: 1, column: 1 }, { row: 2, column: 1 }])).toEqual({ row: 1, column: 1, rows: 2, columns: 2 });
    // «Enero» ocupa dos filas.
    expect(mergeRegion(table, [{ row: 0, column: 0 }, { row: 0, column: 1 }])).toEqual({ row: 0, column: 0, rows: 2, columns: 2 });
  });

  it("una sola celda, o sitios sin celda, no son nada que combinar", () => {
    expect(mergeRegion(table, [{ row: 2, column: 0 }])).toBeNull();
    expect(mergeRegion(table, [{ row: 2, column: 0 }, { row: 2, column: 0 }])).toBeNull();
    // Debajo de «Enero» no empieza ninguna celda.
    expect(mergeRegion(table, [{ row: 1, column: 0 }])).toBeNull();
    // «Febrero» sola ocupa dos sitios, pero es una celda: ya está combinada.
    expect(mergeRegion(table, [{ row: 1, column: 1 }])).toBeNull();
  });

  it("los comandos, tal como los espera el núcleo", () => {
    expect(mergeCellsOp("tb1", { row: 0, column: 1, rows: 1, columns: 2 })).toEqual({
      op: "merge_cells",
      id: "tb1",
      row: 0,
      column: 1,
      rows: 1,
      columns: 2,
    });
    expect(splitCellOp("tb1", 1, 1)).toEqual({ op: "split_cell", id: "tb1", row: 1, column: 1 });
  });
});
