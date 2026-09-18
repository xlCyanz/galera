import { describe, expect, it } from "vitest";

import type { Element } from "../types/model";
import { DEFAULT_BORDER, MIXED, fillOps, radiusOps, shapeFields, strokeOps } from "./shapeFields";

const rect = (id: string, extra: Partial<Extract<Element, { type: "rect" }>> = {}): Element => ({
  type: "rect", id, x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: "#ff0000", stroke: null, radius: 0, ...extra,
});
const ellipse: Element = {
  type: "ellipse", id: "e1", x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: "#ff0000",
  stroke: { color: "#000000", width: 1, dash: "dotted" },
};
const line: Element = {
  type: "line", id: "l1", x: 0, y: 0, x2: 10, y2: 0, rotation: 0, stroke: { color: "#000000", width: 0.5 },
};

describe("shapeFields", () => {
  it("con una forma, sus valores", () => {
    const fields = shapeFields([rect("r1", { radius: 3 })]);
    expect(fields).toMatchObject({ hasFill: true, hasRadius: true, onlyLines: false, fill: "#ff0000", stroked: false, radius: 3 });
    expect(fields.strokeWidth).toBeUndefined();
  });

  it("con varias, lo común se enseña y lo distinto es mixto", () => {
    const fields = shapeFields([rect("r1", { stroke: { color: "#000000", width: 1 } }), ellipse]);
    expect(fields.fill).toBe("#ff0000");
    expect(fields.stroked).toBe(true);
    expect(fields.strokeColor).toBe("#000000");
    expect(fields.strokeWidth).toBe(1);
    expect(fields.dash).toBe(MIXED);
    expect(fields.radius).toBe(0);

    const other = shapeFields([rect("r1"), rect("r2", { fill: null, radius: 2 }), line]);
    expect(other.fill).toBe(MIXED);
    expect(other.stroked).toBe(MIXED);
    expect(other.radius).toBe(MIXED);
  });

  it("solo líneas: sin relleno, y el trazo no se puede quitar", () => {
    expect(shapeFields([line])).toMatchObject({ hasFill: false, hasRadius: false, onlyLines: true, stroked: true, dash: null });
  });
});

describe("comandos", () => {
  it("el relleno se cambia o se quita solo donde se aplica y cambia algo", () => {
    expect(fillOps([rect("r1"), line, rect("r2", { fill: null })], null)).toEqual([
      { op: "set_property", id: "r1", property: { name: "fill", value: null } },
    ]);
    expect(fillOps([rect("r1")], "#00ff0080")).toEqual([
      { op: "set_property", id: "r1", property: { name: "fill", value: "#00ff0080" } },
    ]);
  });

  it("activar un borde parte del de por defecto; quitarlo no toca las líneas", () => {
    expect(strokeOps([rect("r1")], {})).toEqual([
      { op: "set_property", id: "r1", property: { name: "stroke", value: DEFAULT_BORDER } },
    ]);
    expect(strokeOps([ellipse, line], null)).toEqual([
      { op: "set_property", id: "e1", property: { name: "stroke", value: null } },
    ]);
  });

  it("un cambio parcial conserva el resto de cada trazo; continuo quita el estilo", () => {
    expect(strokeOps([ellipse, line], { width: 2 })).toEqual([
      { op: "set_property", id: "e1", property: { name: "stroke", value: { color: "#000000", width: 2, dash: "dotted" } } },
      { op: "set_property", id: "l1", property: { name: "stroke", value: { color: "#000000", width: 2 } } },
    ]);
    expect(strokeOps([ellipse], { dash: null })).toEqual([
      { op: "set_property", id: "e1", property: { name: "stroke", value: { color: "#000000", width: 1 } } },
    ]);
    expect(strokeOps([line], { color: "#000000" })).toEqual([]);
  });

  it("el radio, solo en rectángulos y nunca negativo", () => {
    expect(radiusOps([rect("r1"), ellipse], 4)).toEqual([
      { op: "set_property", id: "r1", property: { name: "radius", value: 4 } },
    ]);
    expect(radiusOps([rect("r1", { radius: 2 })], -3)).toEqual([
      { op: "set_property", id: "r1", property: { name: "radius", value: 0 } },
    ]);
  });
});
