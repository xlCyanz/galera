import { describe, expect, it } from "vitest";

import { HANDLE_POSITION, RESIZE_HANDLES, resizeCursor } from "./handleGeometry";

describe("manejadores", () => {
  it("son ocho: cuatro esquinas y cuatro lados", () => {
    expect(RESIZE_HANDLES).toHaveLength(8);
    const corners = RESIZE_HANDLES.filter((h) => h.length === 2);
    const sides = RESIZE_HANDLES.filter((h) => h.length === 1);
    expect(corners).toEqual(["nw", "ne", "se", "sw"]);
    expect(sides).toEqual(["n", "e", "s", "w"]);
    for (const corner of corners) {
      const { x, y } = HANDLE_POSITION[corner];
      expect([x, y].every((v) => v === 0 || v === 1)).toBe(true);
    }
  });
});

describe("resizeCursor", () => {
  it("sin giro, el de cada dirección", () => {
    expect(resizeCursor("n", 0)).toBe("ns-resize");
    expect(resizeCursor("s", 0)).toBe("ns-resize");
    expect(resizeCursor("e", 0)).toBe("ew-resize");
    expect(resizeCursor("w", 0)).toBe("ew-resize");
    expect(resizeCursor("ne", 0)).toBe("nesw-resize");
    expect(resizeCursor("sw", 0)).toBe("nesw-resize");
    expect(resizeCursor("nw", 0)).toBe("nwse-resize");
    expect(resizeCursor("se", 0)).toBe("nwse-resize");
  });

  it("con el elemento girado, el de la dirección en pantalla", () => {
    expect(resizeCursor("n", 90)).toBe("ew-resize");
    expect(resizeCursor("e", 90)).toBe("ns-resize");
    expect(resizeCursor("n", 45)).toBe("nesw-resize");
    expect(resizeCursor("nw", 45)).toBe("ns-resize");
    // Se redondea al cursor más cercano.
    expect(resizeCursor("n", 20)).toBe("ns-resize");
    expect(resizeCursor("n", 30)).toBe("nesw-resize");
  });

  it("los giros negativos y de más de una vuelta dan lo mismo", () => {
    expect(resizeCursor("n", -90)).toBe(resizeCursor("n", 270));
    expect(resizeCursor("ne", -45)).toBe("ns-resize");
    expect(resizeCursor("e", 450)).toBe(resizeCursor("e", 90));
  });
});
