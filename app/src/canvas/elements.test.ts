import { describe, expect, it } from "vitest";

import type { Document } from "../types/model";
import { elementBounds, findElement } from "./elements";

const document: Document = {
  version: 1,
  meta: { title: "x" },
  fonts: [],
  assets: {},
  variables: {},
  pages: [
    { id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] },
    {
      id: "p2",
      size: { width: 210, height: 297, unit: "mm" },
      elements: [
        { type: "rect", id: "r1", x: 5, y: 6, w: 7, h: null, rotation: 15, fill: null, stroke: null, radius: 0 },
        {
          type: "line",
          id: "l1",
          x: 50,
          y: 40,
          x2: 20,
          y2: 60,
          rotation: 0,
          stroke: { color: "#000000", width: 0.5 },
        },
      ],
    },
  ],
};

describe("elementos", () => {
  it("encuentra un elemento y su página", () => {
    expect(findElement(document, "r1")).toEqual({
      pageIndex: 1,
      box: { x: 5, y: 6, w: 7, h: null, rotation: 15 },
    });
    expect(findElement(document, "nadie")).toBeNull();
  });

  it("una línea ocupa la caja de sus extremos, en cualquier sentido", () => {
    const line = document.pages[1]!.elements[1]!;
    expect(elementBounds(line)).toEqual({ x: 20, y: 40, w: 30, h: 20, rotation: 0 });
  });
});
