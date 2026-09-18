import { describe, expect, it } from "vitest";

import type { Document } from "../types/model";
import { CASCADE_MM, DEFAULT_IMAGE_WIDTH_MM, MIN_IMAGE_WIDTH_MM, imageElements } from "./insertImages";

const document: Document = {
  version: 1,
  meta: { title: "x" },
  fonts: [],
  assets: {},
  variables: {},
  pages: [
    {
      id: "p1",
      size: { width: 200, height: 100, unit: "mm" },
      elements: [{ type: "image", id: "image-1", x: 0, y: 0, w: 10, h: null, rotation: 0, asset: "viejo" }],
    },
  ],
};

describe("imageElements", () => {
  it("una imagen por clave, con el ancho por defecto y el alto a Typst (su proporción)", () => {
    const [element] = imageElements(document, [{ key: "logo", path: "assets/logo.png" }], { x: 20, y: 30 }, 200);
    expect(element).toEqual({ type: "image", id: "image-2", x: 20, y: 30, w: DEFAULT_IMAGE_WIDTH_MM, h: null, rotation: 0, asset: "logo" });
  });

  it("varias a la vez, en cascada y con ids distintos", () => {
    const elements = imageElements(
      document,
      [
        { key: "a", path: "assets/a.png" },
        { key: "b", path: "assets/b.jpg" },
        { key: "c", path: "assets/c.svg" },
      ],
      { x: 10, y: 10 },
      200,
    );
    expect(elements.map((e) => e.id)).toEqual(["image-2", "image-3", "image-4"]);
    expect(elements.map((e) => [e.x, e.y])).toEqual([
      [10, 10],
      [10 + CASCADE_MM, 10 + CASCADE_MM],
      [10 + 2 * CASCADE_MM, 10 + 2 * CASCADE_MM],
    ]);
  });

  it("no se crea más ancha que lo que queda de página, ni más estrecha que el mínimo", () => {
    const at = (x: number) => imageElements(document, [{ key: "a", path: "assets/a.png" }], { x, y: 0 }, 200)[0]!;
    expect(at(170)).toMatchObject({ w: 30 });
    expect(at(198)).toMatchObject({ w: MIN_IMAGE_WIDTH_MM });
  });
});
