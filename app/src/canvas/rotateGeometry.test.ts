import { describe, expect, it } from "vitest";

import { formatAngle, normalizeDegrees, pointerAngle, rotationFor, sameRotation } from "./rotateGeometry";

const center = { x: 100, y: 100 };

describe("pointerAngle", () => {
  it("mide desde arriba y en sentido horario, con la y hacia abajo", () => {
    expect(pointerAngle(center, { x: 100, y: 50 })).toBeCloseTo(0, 9);
    expect(pointerAngle(center, { x: 150, y: 100 })).toBeCloseTo(90, 9);
    expect(pointerAngle(center, { x: 100, y: 150 })).toBeCloseTo(180, 9);
    expect(pointerAngle(center, { x: 50, y: 100 })).toBeCloseTo(-90, 9);
  });
});

describe("normalizeDegrees", () => {
  it("deja el ángulo en (-180, 180], como el layout", () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(270)).toBe(-90);
    expect(normalizeDegrees(-450)).toBe(-90);
    expect(normalizeDegrees(725)).toBe(5);
  });
});

describe("rotationFor", () => {
  const up = { x: 100, y: 0 };
  const right = { x: 200, y: 100 };

  it("gira lo que gira el puntero alrededor del centro, desde el giro de partida", () => {
    expect(rotationFor(0, center, up, right, false)).toBeCloseTo(90, 9);
    expect(rotationFor(30, center, up, right, false)).toBeCloseTo(120, 9);
    expect(rotationFor(120, center, up, right, false)).toBeCloseTo(-150, 9);
  });

  it("con snap da múltiplos de 15° del giro absoluto", () => {
    const pointer = { x: 100 + 100 * Math.sin(0.4), y: 100 - 100 * Math.cos(0.4) }; // ≈ 22,9°
    expect(rotationFor(0, center, up, pointer, true)).toBe(30);
    expect(rotationFor(7, center, up, pointer, true)).toBe(30);
    expect(rotationFor(7, center, up, pointer, false)).toBeCloseTo(29.918, 3);
  });

  it("redondea a la milésima de grado", () => {
    const value = rotationFor(0, center, up, { x: 173, y: 31 }, false);
    expect(Math.round(value * 1000) / 1000).toBe(value);
  });
});

describe("sameRotation", () => {
  it("compara vueltas completas como iguales", () => {
    expect(sameRotation(10, 10)).toBe(true);
    expect(sameRotation(180, -180)).toBe(true);
    expect(sameRotation(10, 10.5)).toBe(false);
  });
});

describe("formatAngle", () => {
  it("con coma decimal y un decimal como mucho", () => {
    expect(formatAngle(37.5)).toBe("37,5°");
    expect(formatAngle(45)).toBe("45°");
    expect(formatAngle(-12.345)).toBe("-12,3°");
    expect(formatAngle(-0.01)).toBe("0°");
  });
});
