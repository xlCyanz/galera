import { describe, expect, it } from "vitest";

import type { Glyph } from "../types/layout";
import type { Document } from "../types/model";
import { deleteOp, formatOp, inBox, insertOp, keyOf, linesOf, onPage, runsOf } from "./target";

const document: Document = {
  version: 1,
  meta: { title: "x" },
  fonts: [],
  assets: {},
  variables: {},
  flows: {
    cuerpo: {
      content: [{ text: "Fluye", bold: false, italic: false, underline: false }],
      style: { font: "Inter", size: 11, color: "#000000", align: "left", leading: 0.65 },
      zones: ["z1"],
    },
  },
  pages: [
    {
      id: "p1",
      size: { width: 200, height: 100, unit: "mm" },
      elements: [
        {
          type: "text",
          id: "t1",
          x: 10,
          y: 10,
          w: 80,
          h: null,
          rotation: 0,
          content: [{ text: "Suelto", bold: false, italic: false, underline: false }],
          style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
          lines: [{ list: "bullet", level: 0 }],
        },
        { type: "flow", id: "z1", x: 10, y: 40, w: 80, h: 20, rotation: 0, flow: "cuerpo" },
      ],
    },
  ],
};

const element = { kind: "element", id: "t1" } as const;
const flow = { kind: "flow", name: "cuerpo" } as const;

const glyph = (page: number, x: number, y: number): Glyph => ({
  page,
  text_index: 0,
  line: 0,
  x,
  y,
  width: 3,
  line_height: 5,
  baseline: y + 4,
});

describe("qué texto se está escribiendo", () => {
  it("saca los tramos de un bloque o de un flujo", () => {
    expect(runsOf(document, element)?.[0]?.text).toBe("Suelto");
    expect(runsOf(document, flow)?.[0]?.text).toBe("Fluye");
    expect(runsOf(document, { kind: "flow", name: "nada" })).toBeNull();
    expect(runsOf(document, { kind: "element", id: "z1" })).toBeNull();
    expect(runsOf(null, element)).toBeNull();
  });

  /** Un flujo todavía no tiene listas: su texto va seguido. */
  it("los estilos de línea son solo de un bloque", () => {
    expect(linesOf(document, element)).toHaveLength(1);
    expect(linesOf(document, flow)).toEqual([]);
  });

  it("los comandos son los del sitio donde vive el texto", () => {
    expect(insertOp(element, 2, "x")).toEqual({ op: "insert_text", id: "t1", at: 2, text: "x" });
    expect(insertOp(flow, 2, "x")).toEqual({
      op: "insert_flow_text",
      flow: "cuerpo",
      at: 2,
      text: "x",
    });
    expect(deleteOp(flow, 1, 3)).toEqual({
      op: "delete_flow_text",
      flow: "cuerpo",
      from: 1,
      to: 3,
    });
    expect(formatOp(flow, 1, 3, { bold: true })).toEqual({
      op: "format_flow_text",
      flow: "cuerpo",
      from: 1,
      to: 3,
      format: { bold: true },
    });
  });

  it("un flujo y un elemento con el mismo nombre no se confunden", () => {
    expect(keyOf({ kind: "element", id: "cuerpo" })).toBe("cuerpo");
    expect(keyOf(flow)).toBe("flujo:cuerpo");
  });
});

describe("qué glifos se miran", () => {
  const glyphs = [glyph(0, 10, 10), glyph(0, 70, 10), glyph(1, 10, 10)];

  it("los de una página", () => {
    expect(onPage(glyphs, 0)).toHaveLength(2);
    expect(onPage(glyphs, 1)).toHaveLength(1);
    expect(onPage(glyphs, 2)).toEqual([]);
  });

  /** Dos zonas de la misma página están a la misma altura: lo que las
   * distingue es la caja, no la página. */
  it("los de una zona, y no los de la de al lado", () => {
    const zone = { page: 0, x: 60, y: 5, w: 40, h: 20 };
    expect(inBox(glyphs, zone)).toEqual([glyphs[1]]);
    expect(inBox(glyphs, { page: 1, x: 0, y: 0, w: 40, h: 20 })).toEqual([glyphs[2]]);
  });
});
