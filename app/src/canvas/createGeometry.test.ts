import { describe, expect, it } from "vitest";

import type { Document } from "../types/model";
import {
  DEFAULT_FILL,
  DEFAULT_SIZE,
  DEFAULT_STROKE,
  defaultShape,
  newElementId,
  shapeElement,
  shapeFromDrag,
} from "./createGeometry";

describe("shapeFromDrag", () => {
  it("una caja va de un punto al otro, arrastre hacia donde sea", () => {
    expect(shapeFromDrag("rect", { x: 10, y: 20 }, { x: 50, y: 45 }, false)).toEqual({ kind: "rect", x: 10, y: 20, w: 40, h: 25 });
    expect(shapeFromDrag("ellipse", { x: 50, y: 45 }, { x: 10, y: 20 }, false)).toEqual({ kind: "ellipse", x: 10, y: 20, w: 40, h: 25 });
  });

  it("con Shift, cuadrado o círculo hacia donde se arrastre", () => {
    expect(shapeFromDrag("rect", { x: 10, y: 20 }, { x: 50, y: 30 }, true)).toEqual({ kind: "rect", x: 10, y: 20, w: 40, h: 40 });
    expect(shapeFromDrag("ellipse", { x: 50, y: 50 }, { x: 40, y: 20 }, true)).toEqual({ kind: "ellipse", x: 20, y: 20, w: 30, h: 30 });
  });

  it("nunca mide menos de 1 mm", () => {
    expect(shapeFromDrag("rect", { x: 10, y: 10 }, { x: 10.2, y: 30 }, false)).toMatchObject({ w: 1, h: 20 });
  });

  it("una línea va de extremo a extremo; con Shift, a 45°", () => {
    expect(shapeFromDrag("line", { x: 10, y: 10 }, { x: 40, y: 22 }, false)).toEqual({ kind: "line", x: 10, y: 10, x2: 40, y2: 22 });
    // Casi horizontal: horizontal, con la misma longitud.
    const flat = shapeFromDrag("line", { x: 10, y: 10 }, { x: 40, y: 13 }, true);
    expect(flat.kind === "line" && flat.y2).toBe(10);
    expect(flat.kind === "line" && flat.x2).toBeCloseTo(10 + Math.hypot(30, 3), 3);
    // Cerca de la diagonal: diagonal.
    const diagonal = shapeFromDrag("line", { x: 0, y: 0 }, { x: 30, y: -26 }, true);
    expect(diagonal.kind === "line" && diagonal.x2).toBeCloseTo(-(diagonal.kind === "line" ? diagonal.y2 : 0), 3);
  });

  it("redondea a la milésima de milímetro", () => {
    expect(shapeFromDrag("rect", { x: 0.1, y: 0.2 }, { x: 0.1 + 1 / 3, y: 10 }, false)).toMatchObject({ x: 0.1, w: 1 });
    const shape = shapeFromDrag("rect", { x: 0, y: 0 }, { x: 10 / 3, y: 10 }, false);
    expect(shape.kind !== "line" && shape.w).toBe(3.333);
  });
});

describe("defaultShape", () => {
  it("un clic crea el tamaño por defecto desde el punto", () => {
    expect(defaultShape("rect", { x: 5, y: 6 })).toEqual({ kind: "rect", x: 5, y: 6, ...DEFAULT_SIZE.rect });
    expect(defaultShape("line", { x: 5, y: 6 })).toEqual({ kind: "line", x: 5, y: 6, x2: 5 + DEFAULT_SIZE.line.w, y2: 6 });
  });
});

describe("newElementId", () => {
  const document: Document = {
    version: 1,
    meta: { title: "x" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [
      { id: "rect-2", size: { width: 10, height: 10, unit: "mm" }, elements: [] },
      {
        id: "p2",
        size: { width: 10, height: 10, unit: "mm" },
        elements: [{ type: "rect", id: "rect-1", x: 0, y: 0, w: 1, h: 1, rotation: 0, fill: null, stroke: null, radius: 0 }],
      },
    ],
  };

  it("el primero libre, sin chocar con elementos ni con páginas", () => {
    expect(newElementId(document, "rect")).toBe("rect-3");
    expect(newElementId(document, "line")).toBe("line-1");
  });
});

describe("shapeElement", () => {
  it("con el estilo por defecto", () => {
    expect(shapeElement("rect-1", { kind: "rect", x: 1, y: 2, w: 3, h: 4 })).toEqual({
      type: "rect", id: "rect-1", x: 1, y: 2, w: 3, h: 4, rotation: 0, fill: DEFAULT_FILL, stroke: null, radius: 0,
    });
    expect(shapeElement("line-1", { kind: "line", x: 1, y: 2, x2: 3, y2: 4 })).toEqual({
      type: "line", id: "line-1", x: 1, y: 2, x2: 3, y2: 4, rotation: 0, stroke: DEFAULT_STROKE,
    });
  });
});
