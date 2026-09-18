import { describe, expect, it } from "vitest";

import type { Element, Page } from "../types/model";
import { elementLabel, gapAt, layerRows, reorderIndex } from "./layerOrder";

const rect = (id: string): Element => ({ type: "rect", id, x: 0, y: 0, w: 1, h: 1, rotation: 0, fill: null, stroke: null, radius: 0 });
const text = (id: string, content: string): Element => ({
  type: "text", id, x: 0, y: 0, w: 1, h: null, rotation: 0,
  content: [{ text: content, bold: false, italic: false, underline: false }],
  style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
});

const page: Page = {
  id: "p1",
  size: { width: 10, height: 10, unit: "mm" },
  elements: [rect("fondo"), text("titulo", "Informe"), { type: "image", id: "i1", x: 0, y: 0, w: 1, h: null, rotation: 0, asset: "logo" }],
};

describe("layerRows", () => {
  it("la capa de arriba (la última del arreglo) primero", () => {
    expect(layerRows(page).map((row) => [row.id, row.index])).toEqual([
      ["i1", 2],
      ["titulo", 1],
      ["fondo", 0],
    ]);
  });
});

describe("elementLabel", () => {
  it("un texto se llama por lo que dice; una imagen, por su recurso; lo demás, por su tipo", () => {
    expect(elementLabel(text("t", "Hola\n  mundo"))).toBe("Hola mundo");
    expect(elementLabel(text("t", "Un texto muy largo que no cabe entero en la fila del panel"))).toBe(
      "Un texto muy largo que no cabe…",
    );
    expect(elementLabel(text("t", "   "))).toBe("Texto");
    expect(elementLabel(page.elements[2]!)).toBe("logo");
    expect(elementLabel(rect("r"))).toBe("Rectángulo");
  });
});

describe("gapAt", () => {
  const rows = [
    { top: 0, bottom: 20 },
    { top: 20, bottom: 40 },
    { top: 40, bottom: 60 },
  ];
  it("cuenta las filas cuya mitad queda por encima", () => {
    expect(gapAt(-5, rows)).toBe(0);
    expect(gapAt(9, rows)).toBe(0);
    expect(gapAt(11, rows)).toBe(1);
    expect(gapAt(35, rows)).toBe(2);
    expect(gapAt(100, rows)).toBe(3);
  });
});

describe("reorderIndex", () => {
  // Tres elementos: en pantalla, [2, 1, 0] (el 2 arriba).
  it("subir la de abajo del todo arriba del todo la deja la última del arreglo", () => {
    expect(reorderIndex(0, 0, 3)).toBe(2);
  });

  it("bajar la de arriba del todo abajo del todo la deja la primera", () => {
    expect(reorderIndex(2, 3, 3)).toBe(0);
  });

  it("entre dos filas", () => {
    // La de arriba (2) entre la segunda y la tercera fila: queda la del medio.
    expect(reorderIndex(2, 2, 3)).toBe(1);
    // La de abajo (0) entre la primera y la segunda fila: también en medio.
    expect(reorderIndex(0, 1, 3)).toBe(1);
  });

  it("soltarla justo encima o debajo de sí misma no la mueve", () => {
    expect(reorderIndex(1, 1, 3)).toBeNull();
    expect(reorderIndex(1, 2, 3)).toBeNull();
  });
});

describe("filas con nombre, ocultas y bloqueadas", () => {
  it("el nombre propio manda sobre el deducido, y las marcas pasan a la fila", () => {
    const named: Page = {
      ...page,
      elements: [{ ...rect("r"), name: "Fondo", hidden: true, locked: true }, { ...rect("s"), name: "  " }],
    };
    expect(layerRows(named)).toEqual([
      { id: "s", type: "rect", label: "Rectángulo", name: null, index: 1, hidden: false, locked: false },
      { id: "r", type: "rect", label: "Fondo", name: "Fondo", index: 0, hidden: true, locked: true },
    ]);
  });
});
