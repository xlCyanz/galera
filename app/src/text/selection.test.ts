import { describe, expect, it } from "vitest";

import type { Glyph, LayoutBox } from "../types/layout";
import { indexAt, paragraphAt, selectionRects, unrotate, wordAt } from "./selection";

/** «Hola mundo» partido en dos líneas: «Hola» y «mundo», glifos de 5 mm.
 * El espacio del corte no se dibuja. */
const glyphs: Glyph[] = [0, 1, 2, 3, 5, 6, 7, 8, 9].map((text_index) => {
  const line = text_index < 5 ? 0 : 1;
  const column = line === 0 ? text_index : text_index - 5;
  return {
    page: 0,
    text_index,
    line,
    x: 20 + column * 5,
    y: 20 + line * 6,
    width: 5,
    line_height: 5,
    baseline: 24 + line * 6,
  };
});

const box: LayoutBox = {
  id: "t1",
  page: 0,
  x: 20,
  y: 20,
  w: 40,
  h: 12,
  rotation: 0,
  bounds: { x: 20, y: 20, w: 40, h: 12 },
  line: null,
  overflow: 0,
};

const TEXT = "Hola mundo";

describe("del puntero al texto", () => {
  it("la mitad izquierda de una letra pone el cursor delante; la derecha, detrás", () => {
    expect(indexAt(glyphs, TEXT, 21, 22)).toBe(0);
    expect(indexAt(glyphs, TEXT, 24, 22)).toBe(1);
  });

  it("más allá del final de una línea, al final de esa línea", () => {
    expect(indexAt(glyphs, TEXT, 99, 22)).toBe(4);
    expect(indexAt(glyphs, TEXT, 99, 28)).toBe(10);
  });

  it("por encima del texto, a la primera línea; por debajo, a la última", () => {
    expect(indexAt(glyphs, TEXT, 21, 0)).toBe(0);
    expect(indexAt(glyphs, TEXT, 21, 99)).toBe(5);
  });

  it("sin glifos, al principio", () => {
    expect(indexAt([], "", 50, 50)).toBe(0);
  });

  it("un elemento girado se señala por donde se ve", () => {
    const turned: LayoutBox = { ...box, rotation: 90 };
    // El centro no se mueve al girar.
    expect(unrotate(turned, 40, 26)).toEqual({ x: 40, y: 26 });
    // Seis milímetros a la derecha y seis por encima del centro, girado 90°,
    // caen seis a la izquierda y seis por encima en el texto sin girar.
    const point = unrotate(turned, 46, 20);
    expect(point.x).toBeCloseTo(34);
    expect(point.y).toBeCloseTo(20);
    // Sin giro, el punto se queda como está.
    expect(unrotate(box, 30, 25)).toEqual({ x: 30, y: 25 });
  });
});

describe("palabras y párrafos", () => {
  it("el doble clic coge la palabra entera", () => {
    expect(wordAt(TEXT, 2)).toEqual({ start: 0, end: 4 });
    expect(wordAt(TEXT, 7)).toEqual({ start: 5, end: 10 });
  });

  it("una palabra con tilde se coge entera, contada en bytes", () => {
    const text = "el café está";
    // «café» son cuatro caracteres y cinco bytes: la é ocupa dos.
    expect(wordAt(text, 4)).toEqual({ start: 3, end: 8 });
    expect(text.slice(3, 7)).toBe("café");
  });

  it("el hueco entre dos palabras es su propio tramo", () => {
    expect(wordAt(TEXT, 4)).toEqual({ start: 4, end: 5 });
  });

  it("el triple clic coge el párrafo, sin los saltos de línea", () => {
    const text = "uno\ndos\ntres";
    expect(paragraphAt(text, 0)).toEqual({ start: 0, end: 3 });
    expect(paragraphAt(text, 5)).toEqual({ start: 4, end: 7 });
    expect(paragraphAt(text, 9)).toEqual({ start: 8, end: 12 });
  });
});

describe("los rectángulos de la selección", () => {
  it("cubren los glifos seleccionados de una línea", () => {
    expect(selectionRects(glyphs, 1, 3)).toEqual([{ x: 25, y: 20, w: 10, h: 5 }]);
  });

  it("una selección de varias líneas se dibuja por líneas", () => {
    expect(selectionRects(glyphs, 2, 7)).toEqual([
      { x: 30, y: 20, w: 10, h: 5 },
      { x: 20, y: 26, w: 10, h: 5 },
    ]);
  });

  it("al revés es lo mismo", () => {
    expect(selectionRects(glyphs, 7, 2)).toEqual(selectionRects(glyphs, 2, 7));
  });

  it("sin nada seleccionado no hay rectángulos", () => {
    expect(selectionRects(glyphs, 3, 3)).toEqual([]);
    expect(selectionRects([], 0, 5)).toEqual([]);
  });

  it("el espacio por el que Typst partió la línea no se pinta", () => {
    // Del byte 3 al 6: la «a» de la primera línea y la «m» de la segunda.
    expect(selectionRects(glyphs, 3, 7)).toEqual([
      { x: 35, y: 20, w: 5, h: 5 },
      { x: 20, y: 26, w: 10, h: 5 },
    ]);
  });
});
