import { describe, expect, it } from "vitest";

import type { LayoutBox } from "../types/layout";
import { boxesOf, groupBox, moveOp } from "./group";

const box = (id: string, x: number, y: number, w: number, h: number, page = 0): LayoutBox => ({
  id,
  page,
  x,
  y,
  w,
  h,
  rotation: 0,
  bounds: { x, y, w, h },
  line: null,
  overflow: 0,
});

/** Una caja girada: lo que se ve es `bounds`, no `x`, `y`, `w` y `h`. */
const turned: LayoutBox = {
  ...box("g1", 100, 100, 20, 10),
  rotation: 45,
  bounds: { x: 95, y: 95, w: 30, h: 30 },
};

describe("la caja conjunta", () => {
  it("contiene a todas", () => {
    expect(groupBox([box("a", 10, 20, 30, 40), box("b", 50, 10, 20, 20)])).toEqual({
      x: 10,
      y: 10,
      w: 60,
      h: 50,
    });
  });

  it("de una sola es la suya", () => {
    expect(groupBox([box("a", 10, 20, 30, 40)])).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it("sin cajas no hay caja", () => {
    expect(groupBox([])).toBeNull();
  });

  it("de un elemento girado cuenta la caja que se ve", () => {
    expect(groupBox([turned])).toEqual({ x: 95, y: 95, w: 30, h: 30 });
  });
});

describe("las cajas de la selección", () => {
  const boxes = { a: box("a", 0, 0, 10, 10), b: box("b", 20, 0, 10, 10, 1) };

  it("salen en el orden en que se seleccionaron", () => {
    expect(boxesOf(boxes, ["a"], 0).map((one) => one.id)).toEqual(["a"]);
  });

  it("deja fuera lo que no está compilado y lo de otras páginas", () => {
    expect(boxesOf(boxes, ["a", "b", "fantasma"], 0).map((one) => one.id)).toEqual(["a"]);
    expect(boxesOf(boxes, ["a", "b"], 1).map((one) => one.id)).toEqual(["b"]);
  });
});

describe("el comando que mueve la selección", () => {
  it("con uno solo es un movimiento", () => {
    expect(moveOp(["a"], 5, -2)).toEqual({ op: "move", id: "a", dx: 5, dy: -2 });
  });

  /** El criterio de la tarea: los varios se mueven como un solo cambio. */
  it("con varios es un solo comando compuesto", () => {
    expect(moveOp(["a", "b"], 5, -2)).toEqual({
      op: "batch",
      ops: [
        { op: "move", id: "a", dx: 5, dy: -2 },
        { op: "move", id: "b", dx: 5, dy: -2 },
      ],
    });
  });
});
