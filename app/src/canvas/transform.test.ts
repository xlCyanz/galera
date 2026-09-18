import { describe, expect, it } from "vitest";

import { PX_PER_MM } from "./geometry";
import { canvasTransform, rectToCanvas, toCanvas, toDocument } from "./transform";

const a4 = { width: 210, height: 297, unit: "mm" } as const;
const viewport = { width: 1000, height: 800 };

describe("canvasTransform", () => {
  it("coloca la página centrada y movida, con la escala del zoom", () => {
    const transform = canvasTransform(viewport, a4, 2, { x: 30, y: -40 });
    expect(transform.pxPerMm).toBeCloseTo(PX_PER_MM * 2, 12);
    expect(transform.origin.x).toBeCloseTo((1000 - 210 * PX_PER_MM * 2) / 2 + 30, 9);
    expect(transform.origin.y).toBeCloseTo((800 - 297 * PX_PER_MM * 2) / 2 - 40, 9);
  });
});

describe("conversión", () => {
  const transform = { origin: { x: 100, y: 50 }, pxPerMm: 4 };

  it("de mm a píxeles del área", () => {
    expect(toCanvas(transform, 10, 20)).toEqual({ x: 140, y: 130 });
    expect(rectToCanvas(transform, { x: 10, y: 20, w: 5, h: 2.5 })).toEqual({
      left: 140,
      top: 130,
      width: 20,
      height: 10,
    });
  });

  it("de píxeles a mm es la inversa", () => {
    expect(toDocument(transform, 140, 130)).toEqual({ x: 10, y: 20 });
    const back = toDocument(transform, ...(Object.values(toCanvas(transform, 12.3, 45.6)) as [number, number]));
    expect(back.x).toBeCloseTo(12.3, 12);
    expect(back.y).toBeCloseTo(45.6, 12);
  });
});
