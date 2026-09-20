import { describe, expect, it } from "vitest";

import type { Line } from "../types/model";
import { MIXED } from "../ui/shapeFields";
import { indent, levelOf, linesTouched, listOf, toggleList } from "./lines";

const TEXT = "Uno\nDos\nTres";
/** Las dos primeras líneas son viñetas; la tercera, texto normal. */
const lines: Line[] = [{ list: "bullet" }, { list: "bullet", level: 1 }];

describe("qué líneas toca la selección", () => {
  it("la primera y la última, contando saltos", () => {
    expect(linesTouched(TEXT, 0, 3)).toEqual({ first: 0, last: 0 });
    expect(linesTouched(TEXT, 0, 9)).toEqual({ first: 0, last: 2 });
    expect(linesTouched(TEXT, 5, 5)).toEqual({ first: 1, last: 1 });
  });

  it("al revés es lo mismo", () => {
    expect(linesTouched(TEXT, 9, 0)).toEqual({ first: 0, last: 2 });
  });

  it("los bytes cuentan: una tilde ocupa dos", () => {
    const accented = "café\nsolo";
    // El salto está en el byte 5.
    expect(linesTouched(accented, 5, 5)).toEqual({ first: 0, last: 0 });
    expect(linesTouched(accented, 6, 6)).toEqual({ first: 1, last: 1 });
  });
});

describe("la lista de lo seleccionado", () => {
  it("es la que comparten las líneas", () => {
    expect(listOf(TEXT, lines, 0, 7)).toBe("bullet");
  });

  it("si no todas son lo mismo, sale mezclada", () => {
    expect(listOf(TEXT, lines, 0, 12)).toBe(MIXED);
  });

  it("fuera de una lista no hay ninguna", () => {
    expect(listOf(TEXT, lines, 9, 12)).toBeNull();
    expect(listOf(TEXT, [], 0, 12)).toBeNull();
  });

  it("el nivel es el de la primera línea que toca", () => {
    expect(levelOf(TEXT, lines, 0, 7)).toBe(0);
    expect(levelOf(TEXT, lines, 4, 7)).toBe(1);
    expect(levelOf(TEXT, lines, 9, 12)).toBe(0);
  });
});

describe("hacer y deshacer una lista", () => {
  it("lo que no es lista pasa a serlo, con su nivel", () => {
    expect(toggleList(TEXT, lines, 9, 12, "numbered")).toEqual({ list: "numbered", level: 0 });
    expect(toggleList(TEXT, lines, 4, 7, "numbered")).toEqual({ list: "numbered", level: 1 });
  });

  it("si ya lo son todas, dejan de serlo", () => {
    expect(toggleList(TEXT, lines, 0, 7, "bullet")).toEqual({});
  });
});

describe("cambiar de nivel", () => {
  it("Tab anida y ⇧Tab desanida", () => {
    expect(indent(TEXT, lines, 0, 3, 1)).toEqual({ list: "bullet", level: 1 });
    expect(indent(TEXT, lines, 4, 7, -1)).toEqual({ list: "bullet", level: 0 });
  });

  it("fuera de una lista no hace nada", () => {
    expect(indent(TEXT, lines, 9, 12, 1)).toBeNull();
  });

  it("ni en el borde de arriba ni en el de abajo", () => {
    expect(indent(TEXT, lines, 0, 3, -1)).toBeNull();
    const deep: Line[] = [{ list: "bullet", level: 8 }];
    expect(indent(TEXT, deep, 0, 3, 1)).toBeNull();
  });
});
