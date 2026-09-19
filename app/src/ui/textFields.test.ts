import { describe, expect, it } from "vitest";

import type { Element } from "../types/model";
import { MIN_TEXT_SIZE, textStyleOp } from "./textFields";

const style = { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 } as const;
const text: Element = { type: "text", id: "t1", x: 0, y: 0, w: 50, h: null, rotation: 0, content: [], style };
const rect: Element = { type: "rect", id: "r1", x: 0, y: 0, w: 1, h: 1, rotation: 0, fill: null, stroke: null, radius: 0 };

const value = (change: Parameters<typeof textStyleOp>[1]) => {
  const op = textStyleOp(text, change);
  return op !== null && op.op === "set_property" ? op.property.value : null;
};

describe("textStyleOp", () => {
  it("cambia lo pedido y conserva el resto del estilo", () => {
    expect(value({ size: 18 })).toEqual({ ...style, size: 18 });
    expect(value({ align: "justify", color: "#ff0000" })).toEqual({ ...style, align: "justify", color: "#ff0000" });
  });

  it("respeta los límites y redondea a la centésima", () => {
    expect(value({ size: 0 })).toEqual({ ...style, size: MIN_TEXT_SIZE });
    expect(value({ leading: -1 })).toEqual({ ...style, leading: 0 });
    expect(value({ leading: 0.1 + 0.2 })).toEqual({ ...style, leading: 0.3 });
  });

  it("el espacio entre párrafos se fija o vuelve al de Typst", () => {
    expect(value({ spacing: 2 })).toEqual({ ...style, spacing: 2 });
    const spaced: Element = { ...text, style: { ...style, spacing: 2 } };
    const op = textStyleOp(spaced, { spacing: null });
    expect(op !== null && op.op === "set_property" && op.property.value).toEqual(style);
  });

  it("sin cambio, o si no es un texto, no manda nada", () => {
    expect(textStyleOp(text, { size: 12 })).toBeNull();
    expect(textStyleOp(rect, { size: 20 })).toBeNull();
  });
});
