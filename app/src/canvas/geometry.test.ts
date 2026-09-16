import { describe, expect, it } from "vitest";

import { PX_PER_MM, mmToPx, pageSizeInPx, toMillimeters } from "./geometry";

describe("escala del lienzo", () => {
  it("1 mm son 96/25,4 píxeles al 100 %", () => {
    expect(PX_PER_MM).toBeCloseTo(3.779527559, 9);
    expect(mmToPx(1, 1)).toBe(PX_PER_MM);
  });

  it("el zoom multiplica la escala", () => {
    expect(mmToPx(1, 2)).toBeCloseTo(2 * PX_PER_MM, 12);
    expect(mmToPx(10, 0.25)).toBeCloseTo(2.5 * PX_PER_MM, 12);
    // 25,4 mm son una pulgada: 96 px al 100 %, 768 px al 800 %.
    expect(mmToPx(25.4, 1)).toBeCloseTo(96, 9);
    expect(mmToPx(25.4, 8)).toBeCloseTo(768, 9);
  });
});

describe("toMillimeters", () => {
  it("usa los factores del núcleo", () => {
    expect(toMillimeters(210, "mm")).toBe(210);
    expect(toMillimeters(21, "cm")).toBe(210);
    expect(toMillimeters(8.5, "in")).toBeCloseTo(215.9, 9);
    expect(toMillimeters(72, "pt")).toBeCloseTo(25.4, 9);
  });
});

describe("pageSizeInPx", () => {
  it("A4 conserva su relación de aspecto exacta a cualquier zoom", () => {
    for (const zoom of [0.25, 1, 3.3, 8]) {
      const { width, height } = pageSizeInPx({ width: 210, height: 297, unit: "mm" }, zoom);
      expect(width).toBeCloseTo(210 * PX_PER_MM * zoom, 9);
      expect(height / width).toBeCloseTo(297 / 210, 12);
    }
  });

  it("carta en pulgadas mide 816 × 1056 px al 100 %", () => {
    const { width, height } = pageSizeInPx({ width: 8.5, height: 11, unit: "in" }, 1);
    expect(width).toBeCloseTo(816, 9);
    expect(height).toBeCloseTo(1056, 9);
  });
});
