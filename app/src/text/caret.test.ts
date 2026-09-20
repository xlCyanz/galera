import { describe, expect, it } from "vitest";

import type { Glyph } from "../types/layout";
import { byteIndex, caretAt, lineMove, textIndex } from "./caret";

/** Un glifo de 5 mm de ancho en la línea `line`, empezando en `x`. */
const glyph = (text_index: number, line: number, x: number): Glyph => ({
  text_index,
  line,
  x,
  y: 20 + line * 6,
  width: 5,
  line_height: 5,
  baseline: 24 + line * 6,
});

/** «uno dos» partido en dos líneas: «uno» y «dos». El espacio no se dibuja. */
const TEXT = "uno dos";

const wrapped: Glyph[] = [
  glyph(0, 0, 20),
  glyph(1, 0, 25),
  glyph(2, 0, 30),
  glyph(4, 1, 20),
  glyph(5, 1, 25),
  glyph(6, 1, 30),
];

describe("contar el texto de las dos formas", () => {
  it("las unidades de JavaScript y los bytes coinciden en ASCII", () => {
    expect(byteIndex("hola", 2)).toBe(2);
    expect(textIndex("hola", 2)).toBe(2);
  });

  it("un carácter acentuado ocupa dos bytes y una unidad", () => {
    expect(byteIndex("café", 4)).toBe(5);
    expect(textIndex("café", 5)).toBe(4);
  });

  it("un emoji ocupa cuatro bytes y dos unidades", () => {
    const text = "a🌾b";
    expect(byteIndex(text, 3)).toBe(5);
    expect(textIndex(text, 5)).toBe(3);
    // Y no se parte por la mitad: un byte de en medio cae en su principio.
    expect(textIndex(text, 3)).toBe(1);
  });

  it("los extremos", () => {
    expect(byteIndex("hola", 0)).toBe(0);
    expect(textIndex("hola", 0)).toBe(0);
    expect(textIndex("hola", 99)).toBe(4);
  });
});

describe("dónde va el cursor", () => {
  it("delante de un glifo, en su borde izquierdo", () => {
    expect(caretAt(wrapped, 0)).toEqual({ x: 20, y: 20, height: 5, line: 0 });
    expect(caretAt(wrapped, 2)).toEqual({ x: 30, y: 20, height: 5, line: 0 });
  });

  it("al final del texto, detrás del último glifo", () => {
    expect(caretAt(wrapped, 7)).toEqual({ x: 35, y: 26, height: 5, line: 1 });
  });

  it("en el espacio donde Typst partió la línea, al final de la anterior", () => {
    // El byte 3 es el espacio, que no se dibuja.
    expect(caretAt(wrapped, 3)).toEqual({ x: 35, y: 20, height: 5, line: 0 });
    // Y el 4, ya en la línea siguiente.
    expect(caretAt(wrapped, 4)).toEqual({ x: 20, y: 26, height: 5, line: 1 });
  });

  it("sin glifos no hay dónde ponerlo", () => {
    expect(caretAt([], 0)).toBeNull();
  });
});

describe("subir y bajar de línea", () => {
  it("baja conservando la columna", () => {
    expect(lineMove(wrapped, 1, 1, null, TEXT)).toEqual({ byte: 5, x: 25 });
  });

  it("sube conservando la columna", () => {
    expect(lineMove(wrapped, 6, -1, null, TEXT)).toEqual({ byte: 2, x: 30 });
  });

  it("la columna deseada manda sobre la actual", () => {
    // Se venía de la columna 33, aunque ahora el cursor esté en la 20: el
    // cursor va al lado del glifo que caiga más cerca.
    expect(lineMove(wrapped, 4, -1, 33, TEXT)).toEqual({ byte: 3, x: 33 });
    expect(lineMove(wrapped, 4, -1, 32, TEXT)).toEqual({ byte: 2, x: 32 });
  });

  it("si la columna pasa del final de la línea, al final de esa línea", () => {
    expect(lineMove(wrapped, 0, 1, 99, TEXT)).toEqual({ byte: 7, x: 99 });
    expect(lineMove(wrapped, 5, -1, 99, TEXT)).toEqual({ byte: 3, x: 99 });
  });

  it("fuera de la primera y de la última línea no se va a ningún lado", () => {
    expect(lineMove(wrapped, 0, -1, null, TEXT)).toBeNull();
    expect(lineMove(wrapped, 6, 1, null, TEXT)).toBeNull();
    expect(lineMove([], 0, 1, null, "")).toBeNull();
  });
});
