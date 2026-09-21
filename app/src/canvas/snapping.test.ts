import { describe, expect, it } from "vitest";

import type { Guide } from "../types/snap";
import {
  SNAP_PX,
  WHOLE,
  formatDistance,
  gripsFor,
  guideInPx,
  guideLength,
  isStill,
  sameRect,
  snapOff,
  snapSettings,
} from "./snapping";

const transform = { origin: { x: 10, y: 20 }, pxPerMm: 2 };

const guide = (x1: number, y1: number, x2: number, y2: number, kind: Guide["kind"]): Guide => ({
  line: { x1, y1, x2, y2 },
  kind,
});

describe("qué se le pide al núcleo", () => {
  it("la distancia de enganche va en píxeles y la escala es el zoom", () => {
    expect(snapSettings(4)).toEqual({ threshold: SNAP_PX, scale: 4, margin: null });
    // Al 200 % el mismo enganche son la mitad de milímetros: lo que no
    // cambia es lo que se ve.
    expect(snapSettings(8).threshold).toBe(snapSettings(2).threshold);
  });

  it("arrastrar agarra la caja entera", () => {
    expect(WHOLE).toEqual({ x: "whole", y: "whole" });
  });

  it("cada manejador agarra sus bordes, y ninguno el eje que no toca", () => {
    expect(gripsFor("e")).toEqual({ x: "end", y: "none" });
    expect(gripsFor("w")).toEqual({ x: "start", y: "none" });
    expect(gripsFor("n")).toEqual({ x: "none", y: "start" });
    expect(gripsFor("s")).toEqual({ x: "none", y: "end" });
    expect(gripsFor("nw")).toEqual({ x: "start", y: "start" });
    expect(gripsFor("se")).toEqual({ x: "end", y: "end" });
    expect(gripsFor("ne")).toEqual({ x: "end", y: "start" });
    expect(gripsFor("sw")).toEqual({ x: "start", y: "end" });
  });

  it("⌘ desactiva el ajuste, y las otras teclas no", () => {
    expect(snapOff({ metaKey: true })).toBe(true);
    expect(snapOff({ metaKey: false })).toBe(false);
  });

  it("una respuesta solo vale para su caja", () => {
    const rect = { x: 1, y: 2, w: 3, h: 4 };
    expect(sameRect(rect, { ...rect })).toBe(true);
    expect(sameRect(rect, { ...rect, x: 1.0001 })).toBe(false);
  });

  it("un ajuste que no mueve nada no cambia el elemento de sitio", () => {
    expect(isStill({ dx: 0, dy: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, guides: [] })).toBe(true);
    expect(isStill({ dx: 0.5, dy: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, guides: [] })).toBe(false);
  });
});

describe("cómo se dibuja lo que contesta", () => {
  it("los extremos de una guía se pasan a píxeles con la transformación del lienzo", () => {
    expect(guideInPx(transform, guide(50, 0, 50, 100, "element"))).toEqual({
      x1: 110,
      y1: 20,
      x2: 110,
      y2: 220,
    });
  });

  it("un espaciado mide lo que mide su hueco, en mm", () => {
    expect(guideLength(guide(30, 60, 40, 60, "spacing"))).toBe(10);
    expect(guideLength(guide(30, 20, 30, 32.5, "spacing"))).toBe(12.5);
  });

  it("las distancias se enseñan en milímetros, como el resto del lienzo", () => {
    expect(formatDistance(10)).toBe("10 mm");
    expect(formatDistance(12.34)).toBe("12,3 mm");
  });
});
