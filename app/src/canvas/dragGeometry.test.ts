import { describe, expect, it } from "vitest";

import { PX_PER_MM } from "./geometry";
import { arrowNudge, dragDelta, isStill, rotatedCorners } from "./dragGeometry";

const plain = { shiftKey: false, altKey: false, metaKey: false, ctrlKey: false };

describe("dragDelta", () => {
  it("pasa los píxeles arrastrados a mm con la escala", () => {
    const delta = dragDelta({ x: 100, y: 100 }, { x: 100 + 10 * PX_PER_MM * 2, y: 100 - 5 * PX_PER_MM * 2 }, PX_PER_MM * 2, false);
    expect(delta.dx).toBeCloseTo(10, 9);
    expect(delta.dy).toBeCloseTo(-5, 9);
  });

  it("con Shift, se queda en el eje en el que más se ha movido", () => {
    expect(dragDelta({ x: 0, y: 0 }, { x: 30, y: 12 }, 1, true)).toEqual({ dx: 30, dy: 0 });
    expect(dragDelta({ x: 0, y: 0 }, { x: -5, y: 40 }, 1, true)).toEqual({ dx: 0, dy: 40 });
  });

  it("sin moverse, no hay cambio", () => {
    expect(isStill(dragDelta({ x: 7, y: 8 }, { x: 7, y: 8 }, 3, false))).toBe(true);
    expect(isStill(dragDelta({ x: 7, y: 8 }, { x: 7, y: 9 }, 3, true))).toBe(false);
  });
});

describe("arrowNudge", () => {
  it("1 mm por flecha y 10 con Shift", () => {
    expect(arrowNudge({ ...plain, key: "ArrowRight" })).toEqual({ dx: 1, dy: 0 });
    expect(arrowNudge({ ...plain, key: "ArrowUp" })).toEqual({ dx: 0, dy: -1 });
    expect(arrowNudge({ ...plain, key: "ArrowLeft", shiftKey: true })).toEqual({ dx: -10, dy: 0 });
    expect(arrowNudge({ ...plain, key: "ArrowDown", shiftKey: true })).toEqual({ dx: 0, dy: 10 });
  });

  it("otras teclas o con otros modificadores, nada", () => {
    expect(arrowNudge({ ...plain, key: "a" })).toBeNull();
    expect(arrowNudge({ ...plain, key: "ArrowUp", metaKey: true })).toBeNull();
    expect(arrowNudge({ ...plain, key: "ArrowUp", altKey: true })).toBeNull();
  });
});

describe("rotatedCorners", () => {
  it("sin giro, las esquinas de la caja", () => {
    expect(rotatedCorners({ x: 10, y: 20, w: 30, h: 40 }, 0)).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
  });

  it("girada 90° en sentido horario, alrededor del centro", () => {
    const [topLeft] = rotatedCorners({ x: 0, y: 0, w: 20, h: 10 }, 90);
    // Centro (10, 5): la esquina (0, 0) va a (15, -5).
    expect(topLeft!.x).toBeCloseTo(15, 9);
    expect(topLeft!.y).toBeCloseTo(-5, 9);
  });
});
