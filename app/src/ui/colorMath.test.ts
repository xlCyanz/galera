import { describe, expect, it } from "vitest";

import { formatColor, hsToWheel, hsvToRgb, parseColor, rgbToHsv, wheelToHs } from "./colorMath";

describe("parseColor y formatColor", () => {
  it("leen las cuatro formas del modelo", () => {
    expect(parseColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
    expect(parseColor("#abc8")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 0x88 / 255 });
    expect(parseColor("#1E40AF")).toEqual({ r: 0x1e, g: 0x40, b: 0xaf, a: 1 });
    expect(parseColor("16a34a80")).toEqual({ r: 0x16, g: 0xa3, b: 0x4a, a: 0x80 / 255 });
    expect(parseColor("rojo")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
  });

  it("escriben largo, en minúsculas y con alfa solo si no es opaco", () => {
    expect(formatColor({ r: 30, g: 64, b: 175, a: 1 })).toBe("#1e40af");
    expect(formatColor({ r: 22, g: 163, b: 74, a: 0x80 / 255 })).toBe("#16a34a80");
    expect(formatColor({ r: 300, g: -4, b: 12.6, a: 2 })).toBe("#ff000d");
    for (const color of ["#1e40af", "#16a34a80", "#000000", "#ffffff00"]) {
      expect(formatColor(parseColor(color)!)).toBe(color);
    }
  });
});

describe("RGB y HSV", () => {
  it("van y vuelven", () => {
    for (const color of ["#ff0000", "#00ff00", "#0000ff", "#1e40af", "#808080", "#000000", "#ffffff", "#f59e0b"]) {
      const rgba = parseColor(color)!;
      expect(formatColor(hsvToRgb(rgbToHsv(rgba)))).toBe(color);
    }
    expect(rgbToHsv({ r: 255, g: 0, b: 0, a: 1 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255, a: 1 }).h).toBeCloseTo(240, 9);
  });
});

describe("la rueda", () => {
  it("el ángulo es el tono (0° arriba) y la distancia, la saturación", () => {
    expect(wheelToHs(0, -70, 70)).toEqual({ h: 0, s: 1 });
    expect(wheelToHs(35, 0, 70).h).toBeCloseTo(90, 9);
    expect(wheelToHs(35, 0, 70).s).toBeCloseTo(0.5, 9);
    expect(wheelToHs(500, 0, 70).s).toBe(1);
    const point = hsToWheel(210, 0.4, 70);
    const back = wheelToHs(point.x, point.y, 70);
    expect(back.h).toBeCloseTo(210, 9);
    expect(back.s).toBeCloseTo(0.4, 9);
  });
});
