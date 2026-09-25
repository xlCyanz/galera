import { describe, expect, it } from "vitest";

import type { Document } from "../types/model";
import { PLACEHOLDER_FLOW, flowCreateOp, newFlowName } from "./flowCreate";

const style = { font: "Inter", size: 11, color: "#000000", align: "left", leading: 0.65 } as const;
const shape = { kind: "flow", x: 110, y: 20, w: 80, h: 100 } as const;

/** Un flujo «cuerpo» con dos zonas, y un rectángulo. */
const document: Document = {
  version: 1,
  meta: { title: "x" },
  fonts: [],
  assets: {},
  variables: {},
  flows: { cuerpo: { content: [], style, zones: ["z1", "z2"] } },
  pages: [
    {
      id: "p1",
      size: { width: 210, height: 297, unit: "mm" },
      elements: [
        { type: "flow", id: "z1", x: 20, y: 20, w: 80, h: 100, rotation: 0, flow: "cuerpo" },
        { type: "flow", id: "z2", x: 20, y: 140, w: 80, h: 100, rotation: 0, flow: "cuerpo" },
        { type: "rect", id: "r1", x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: null, stroke: null, radius: 0 },
      ],
    },
  ],
} as Document;

const zone = (flow: string) => ({ type: "flow", id: "zona-1", ...shapeOf(), rotation: 0, flow });
const shapeOf = () => ({ x: shape.x, y: shape.y, w: shape.w, h: shape.h });

describe("crear una zona de texto", () => {
  /** El criterio de la tarea: sin nada seleccionado, un texto que fluye nuevo. */
  it("sin una zona seleccionada, empieza un flujo nuevo con su texto de ejemplo", () => {
    for (const selection of [[], ["r1"], ["z1", "z2"]]) {
      expect(flowCreateOp(document, "p1", "zona-1", shape, style, selection)).toEqual({
        op: "batch",
        ops: [
          {
            op: "create_flow",
            name: "flujo-1",
            flow: {
              content: [{ text: PLACEHOLDER_FLOW, bold: false, italic: false, underline: false }],
              style,
              zones: [],
            },
          },
          { op: "create", page: "p1", index: null, element: zone("flujo-1") },
          { op: "link_zone", flow: "flujo-1", zone: "zona-1", index: null },
        ],
      });
    }
  });

  /** El criterio de la tarea: con una zona seleccionada, sigue su texto. */
  it("con una zona seleccionada, la nueva va detrás de ella en su cadena", () => {
    expect(flowCreateOp(document, "p1", "zona-1", shape, style, ["z1"])).toEqual({
      op: "batch",
      ops: [
        { op: "create", page: "p1", index: null, element: zone("cuerpo") },
        { op: "link_zone", flow: "cuerpo", zone: "zona-1", index: 1 },
      ],
    });
    expect(flowCreateOp(document, "p1", "zona-1", shape, style, ["z2"])).toMatchObject({
      ops: [{}, { index: 2 }],
    });
  });

  it("el nombre de un flujo nuevo no pisa ninguno", () => {
    expect(newFlowName(document)).toBe("flujo-1");
    const taken = { ...document, flows: { ...document.flows, "flujo-1": document.flows!.cuerpo!, "flujo-2": document.flows!.cuerpo! } };
    expect(newFlowName(taken)).toBe("flujo-3");
    expect(newFlowName({ ...document, flows: undefined } as unknown as Document)).toBe("flujo-1");
  });
});
