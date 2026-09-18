import { describe, expect, it } from "vitest";

import { rotatedCorners } from "./dragGeometry";
import { type Box, MIN_SIZE_MM, changesHeight, formatSize, resizeBox } from "./resizeGeometry";

const plain = { keepRatio: false, fromCenter: false };
const start: Box = { x: 10, y: 20, w: 40, h: 20, rotation: 0 };

function close(actual: Box, expected: Partial<Box>) {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key as keyof Box], key).toBeCloseTo(value, 9);
  }
}

/** Las esquinas en la página, para ver qué se ha quedado quieto. */
const corners = (box: Box) => rotatedCorners(box, box.rotation);

describe("cada manejador ancla lo opuesto", () => {
  it("este y oeste cambian el ancho y dejan quieto el otro lado", () => {
    close(resizeBox(start, "e", 5, 99, plain), { x: 10, y: 20, w: 45, h: 20 });
    close(resizeBox(start, "w", 5, 99, plain), { x: 15, y: 20, w: 35, h: 20 });
  });

  it("norte y sur cambian el alto", () => {
    close(resizeBox(start, "s", 99, 4, plain), { x: 10, y: 20, w: 40, h: 24 });
    close(resizeBox(start, "n", 99, 4, plain), { x: 10, y: 24, w: 40, h: 16 });
  });

  it("una esquina ancla la opuesta", () => {
    close(resizeBox(start, "se", 10, 5, plain), { x: 10, y: 20, w: 50, h: 25 });
    close(resizeBox(start, "nw", 10, 5, plain), { x: 20, y: 25, w: 30, h: 15 });
    close(resizeBox(start, "ne", 10, -5, plain), { x: 10, y: 15, w: 50, h: 25 });
    close(resizeBox(start, "sw", -10, 5, plain), { x: 0, y: 20, w: 50, h: 25 });
  });

  it("girado, estira sus propios lados y la esquina opuesta no se mueve en la página", () => {
    const rotated: Box = { ...start, rotation: 30 };
    // Arrastrar 10 mm a lo largo de su eje horizontal girado.
    const along = { dx: 10 * Math.cos(Math.PI / 6), dy: 10 * Math.sin(Math.PI / 6) };
    const result = resizeBox(rotated, "se", along.dx, along.dy, plain);
    expect(result.w).toBeCloseTo(50, 9);
    expect(result.h).toBeCloseTo(20, 9);
    // La esquina de arriba a la izquierda (la opuesta a «se») sigue en su sitio.
    const [before] = corners(rotated);
    const [after] = corners(result);
    expect(after!.x).toBeCloseTo(before!.x, 9);
    expect(after!.y).toBeCloseTo(before!.y, 9);
  });

  it("girado 90°, el lateral este tira hacia abajo en la página", () => {
    const rotated: Box = { ...start, rotation: 90 };
    const result = resizeBox(rotated, "e", 0, 6, plain);
    expect(result.w).toBeCloseTo(46, 9);
    const west = (box: Box) => {
      const [nw, , , sw] = corners(box);
      return { x: (nw!.x + sw!.x) / 2, y: (nw!.y + sw!.y) / 2 };
    };
    expect(west(result).x).toBeCloseTo(west(rotated).x, 9);
    expect(west(result).y).toBeCloseTo(west(rotated).y, 9);
  });
});

describe("Shift y Alt", () => {
  it("Shift en una esquina mantiene la proporción", () => {
    const result = resizeBox(start, "se", 20, 1, { keepRatio: true, fromCenter: false });
    expect(result.w / result.h).toBeCloseTo(2, 9);
    close(result, { x: 10, y: 20, w: 60, h: 30 });
  });

  it("Shift en un lateral ajusta el otro lado en proporción", () => {
    const result = resizeBox(start, "e", 20, 0, { keepRatio: true, fromCenter: false });
    close(result, { w: 60, h: 30 });
  });

  it("Alt redimensiona desde el centro: los dos lados a la vez y el centro quieto", () => {
    const result = resizeBox(start, "e", 5, 0, { keepRatio: false, fromCenter: true });
    close(result, { x: 5, w: 50, h: 20 });
    expect(result.x + result.w / 2).toBeCloseTo(start.x + start.w / 2, 9);
  });
});

describe("límites", () => {
  it("nunca da un ancho o un alto negativo ni cero", () => {
    const shrunk = resizeBox(start, "se", -100, -100, plain);
    expect(shrunk.w).toBe(MIN_SIZE_MM);
    expect(shrunk.h).toBe(MIN_SIZE_MM);
    // Y el ancla sigue siendo la esquina de arriba a la izquierda.
    close(shrunk, { x: 10, y: 20 });

    const fromWest = resizeBox(start, "w", 100, 0, plain);
    expect(fromWest.w).toBe(MIN_SIZE_MM);
    expect(fromWest.x + fromWest.w).toBeCloseTo(start.x + start.w, 9);
  });

  it("los laterales no cambian el alto", () => {
    expect(changesHeight("e")).toBe(false);
    expect(changesHeight("w")).toBe(false);
    expect(changesHeight("s")).toBe(true);
    expect(changesHeight("ne")).toBe(true);
  });
});

describe("formatSize", () => {
  it("un decimal y milímetros", () => {
    expect(formatSize(80, 40.25)).toBe("80 × 40,3 mm");
  });
});
