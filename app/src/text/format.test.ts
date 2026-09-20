import { describe, expect, it } from "vitest";

import type { Run } from "../types/model";
import { MIXED } from "../ui/shapeFields";
import { formatOf, toggle } from "./format";

const run = (text: string, format: Partial<Omit<Run, "text">> = {}): Run => ({
  text,
  bold: false,
  italic: false,
  underline: false,
  ...format,
});

/** «uno dos tres»: el de en medio en negrita y rojo. */
const runs: Run[] = [
  run("uno "),
  run("dos", { bold: true, color: "#B4161B" }),
  run(" tres"),
];

describe("el formato de lo seleccionado", () => {
  it("es el del tramo si solo se toca uno", () => {
    expect(formatOf(runs, 4, 7)).toEqual({
      bold: true,
      italic: false,
      underline: false,
      color: "#B4161B",
    });
  });

  it("solo está marcado lo que comparten todos", () => {
    expect(formatOf(runs, 0, 12)).toEqual({
      bold: false,
      italic: false,
      underline: false,
      color: MIXED,
    });
  });

  it("el cursor suelto hereda el tramo de su izquierda", () => {
    expect(formatOf(runs, 7, 7).bold).toBe(true);
    expect(formatOf(runs, 8, 8).bold).toBe(false);
  });

  it("al principio del todo, el primer tramo", () => {
    expect(formatOf(runs, 0, 0).bold).toBe(false);
  });

  it("sin tramos no hay nada marcado", () => {
    expect(formatOf([], 0, 0)).toEqual({
      bold: false,
      italic: false,
      underline: false,
      color: null,
    });
  });

  it("los bytes cuentan: una tilde ocupa dos", () => {
    const accented = [run("café", { italic: true }), run(" solo")];
    // La «é» empieza en el byte 3 y ocupa dos.
    expect(formatOf(accented, 3, 5).italic).toBe(true);
    expect(formatOf(accented, 6, 9).italic).toBe(false);
  });
});

describe("cambiar el formato", () => {
  it("si ya lo está todo, se quita; si no, se pone", () => {
    expect(toggle(formatOf(runs, 4, 7), "bold")).toEqual({ bold: false });
    expect(toggle(formatOf(runs, 0, 12), "bold")).toEqual({ bold: true });
    expect(toggle(formatOf(runs, 4, 7), "italic")).toEqual({ italic: true });
  });
});
