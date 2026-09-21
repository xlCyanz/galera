import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Guide } from "../types/snap";
import { Guides } from "./Guides";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const transform = { origin: { x: 100, y: 50 }, pxPerMm: 2 };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function draw(guides: Guide[]) {
  act(() => root.render(<Guides guides={guides} transform={transform} />));
}

const lines = () => [...container.querySelectorAll("line")];

describe("las guías del ajuste", () => {
  it("sin guías no se dibuja nada", () => {
    draw([]);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("una guía de alineación es el segmento que dijo el núcleo, en píxeles", () => {
    draw([{ line: { x1: 50, y1: 10, x2: 50, y2: 90 }, kind: "element" }]);

    expect(lines()).toHaveLength(1);
    const line = lines()[0]!;
    expect(line.getAttribute("x1")).toBe("200");
    expect(line.getAttribute("y1")).toBe("70");
    expect(line.getAttribute("x2")).toBe("200");
    expect(line.getAttribute("y2")).toBe("230");
    expect(container.querySelector("g")?.getAttribute("class")).toBe("snap-guide is-element");
  });

  it("las de la página y las de los márgenes se distinguen de las de los elementos", () => {
    draw([
      { line: { x1: 0, y1: 0, x2: 0, y2: 100 }, kind: "page" },
      { line: { x1: 20, y1: 0, x2: 20, y2: 100 }, kind: "margin" },
    ]);
    const classes = [...container.querySelectorAll("g")].map((one) => one.getAttribute("class"));
    expect(classes).toEqual(["snap-guide is-page", "snap-guide is-margin"]);
  });

  /** El criterio de la tarea: se ven las distancias entre los elementos. */
  it("un espaciado enseña lo que mide, en milímetros", () => {
    draw([{ line: { x1: 30, y1: 60, x2: 45, y2: 60 }, kind: "spacing" }]);

    expect(container.querySelector(".snap-distance")?.textContent).toBe("15 mm");
    // El hueco, y una marca en cada extremo.
    expect(lines()).toHaveLength(3);
  });

  it("la marca de un espaciado cruza el hueco que mide", () => {
    draw([{ line: { x1: 30, y1: 60, x2: 45, y2: 60 }, kind: "spacing" }]);
    const [, first] = lines();
    // Hueco horizontal: sus marcas son verticales.
    expect(first!.getAttribute("x1")).toBe(first!.getAttribute("x2"));
    expect(first!.getAttribute("y1")).not.toBe(first!.getAttribute("y2"));

    draw([{ line: { x1: 30, y1: 60, x2: 30, y2: 80 }, kind: "spacing" }]);
    const [, vertical] = lines();
    expect(vertical!.getAttribute("y1")).toBe(vertical!.getAttribute("y2"));
    expect(vertical!.getAttribute("x1")).not.toBe(vertical!.getAttribute("x2"));
  });

  it("no responde al puntero: es una ayuda, no algo que se pueda agarrar", () => {
    draw([{ line: { x1: 0, y1: 0, x2: 0, y2: 100 }, kind: "page" }]);
    expect(container.querySelector("svg")?.getAttribute("class")).toBe("snap-guides");
  });
});
