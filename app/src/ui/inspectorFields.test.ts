import { describe, expect, it } from "vitest";

import type { LayoutBox } from "../types/layout";
import type { Element } from "../types/model";
import { fieldOp, inspectorFields } from "./inspectorFields";

const rect: Element = { type: "rect", id: "r1", x: 30, y: 40, w: 60, h: 20, rotation: 15, fill: "#ff0000", stroke: null, radius: 0 };
const text: Element = {
  type: "text", id: "t1", x: 10, y: 10, w: 50, h: null, rotation: 0,
  content: [{ text: "Hola", bold: false, italic: false, underline: false }],
  style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
};
const line: Element = { type: "line", id: "l1", x: 50, y: 60, x2: 20, y2: 20, rotation: 0, stroke: { color: "#000000", width: 0.5 } };
const measured = (h: number): LayoutBox => ({ id: "t1", page: 0, x: 10, y: 10, w: 50, h, rotation: 0, bounds: { x: 10, y: 10, w: 50, h }, line: null, overflow: 0 });

describe("inspectorFields", () => {
  it("enseña la caja y el giro del documento", () => {
    const fields = inspectorFields(rect, null);
    expect([fields.x.value, fields.y.value, fields.w.value, fields.h.value, fields.rotation.value]).toEqual([30, 40, 60, 20, 15]);
    expect(Object.values(fields).every((field) => field.editable && !field.auto)).toBe(true);
  });

  it("con alto automático, el alto es el medido y no se edita", () => {
    expect(inspectorFields(text, null).h).toEqual({ value: null, editable: false, auto: true });
    expect(inspectorFields(text, measured(7.5)).h).toEqual({ value: 7.5, editable: false, auto: true });
    expect(inspectorFields(text, measured(7.5)).w.editable).toBe(true);
  });

  it("una línea es la caja de sus extremos: se mueve y gira, pero su tamaño no se edita", () => {
    const fields = inspectorFields(line, null);
    expect([fields.x.value, fields.y.value, fields.w.value, fields.h.value]).toEqual([20, 20, 30, 40]);
    expect(fields.x.editable && fields.rotation.editable).toBe(true);
    expect(fields.w.editable || fields.h.editable).toBe(false);
  });
});

describe("fieldOp", () => {
  it("X e Y mueven lo que falta hasta el valor", () => {
    expect(fieldOp(rect, "x", 35.5)).toEqual({ op: "move", id: "r1", dx: 5.5, dy: 0 });
    expect(fieldOp(rect, "y", 30)).toEqual({ op: "move", id: "r1", dx: 0, dy: -10 });
    expect(fieldOp(line, "x", 25)).toEqual({ op: "move", id: "l1", dx: 5, dy: 0 });
    expect(fieldOp(rect, "x", 30)).toBeNull();
  });

  it("ancho y alto redimensionan sin mover la esquina, con un mínimo", () => {
    expect(fieldOp(rect, "w", 80)).toEqual({ op: "resize", id: "r1", x: 30, y: 40, w: 80, h: 20 });
    expect(fieldOp(rect, "h", -5)).toEqual({ op: "resize", id: "r1", x: 30, y: 40, w: 60, h: 1 });
    // El ancho de un texto con alto automático lo deja automático.
    expect(fieldOp(text, "w", 70)).toEqual({ op: "resize", id: "t1", x: 10, y: 10, w: 70, h: null });
    expect(fieldOp(rect, "w", 60)).toBeNull();
  });

  it("lo que no se edita no manda nada", () => {
    expect(fieldOp(text, "h", 30)).toBeNull();
    expect(fieldOp(line, "w", 30)).toBeNull();
    expect(fieldOp(rect, "x", Number.NaN)).toBeNull();
  });

  it("el giro se normaliza a (-180, 180]", () => {
    expect(fieldOp(rect, "rotation", 45)).toEqual({ op: "rotate", id: "r1", rotation: 45 });
    expect(fieldOp(rect, "rotation", 270)).toEqual({ op: "rotate", id: "r1", rotation: -90 });
    expect(fieldOp(rect, "rotation", -180)).toEqual({ op: "rotate", id: "r1", rotation: 180 });
    expect(fieldOp(rect, "rotation", 375)).toBeNull();
  });
});
