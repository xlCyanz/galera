import { describe, expect, it } from "vitest";

import { PAPERS, describeSize, paperSize, withMeasure, withOrientation } from "./pageSizes";

const a4 = PAPERS.find((paper) => paper.id === "a4")!;

describe("los tamaños de página", () => {
  it("reconoce el papel en las dos orientaciones y en cualquier unidad", () => {
    expect(describeSize({ width: 210, height: 297, unit: "mm" })).toMatchObject({ paper: a4, orientation: "portrait" });
    expect(describeSize({ width: 29.7, height: 21, unit: "cm" })).toMatchObject({
      paper: a4,
      orientation: "landscape",
      width: 297,
      height: 210,
    });
    // La carta en pulgadas, que en mm no da justo.
    expect(describeSize({ width: 8.5, height: 11, unit: "in" }).paper?.name).toBe("Carta");
  });

  it("lo que no es ningún papel, no lo es", () => {
    expect(describeSize({ width: 100, height: 70, unit: "mm" })).toMatchObject({ paper: null, orientation: "landscape" });
    expect(describeSize({ width: 211, height: 297, unit: "mm" }).paper).toBeNull();
    // Cuadrada: vertical.
    expect(describeSize({ width: 100, height: 100, unit: "mm" }).orientation).toBe("portrait");
  });

  it("un papel se pone en la orientación que se pida", () => {
    expect(paperSize(a4, "portrait")).toEqual({ width: 210, height: 297, unit: "mm" });
    expect(paperSize(a4, "landscape")).toEqual({ width: 297, height: 210, unit: "mm" });
  });

  it("girar cambia ancho por alto y conserva la unidad", () => {
    expect(withOrientation({ width: 8.5, height: 11, unit: "in" }, "landscape")).toEqual({
      width: 11,
      height: 8.5,
      unit: "in",
    });
    expect(withOrientation({ width: 8.5, height: 11, unit: "in" }, "portrait")).toBeNull();
    expect(withOrientation({ width: 100, height: 100, unit: "mm" }, "landscape")).toBeNull();
  });

  it("una medida escrita va en mm, y la otra se pasa a mm", () => {
    expect(withMeasure({ width: 21, height: 29.7, unit: "cm" }, "width", 150)).toEqual({
      width: 150,
      height: 297,
      unit: "mm",
    });
  });
});
