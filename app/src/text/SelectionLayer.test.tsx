import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PX_PER_MM } from "../canvas/geometry";
import { canvasTransform } from "../canvas/transform";
import { useEditingStore } from "../store/editing";
import type { Glyph, LayoutBox } from "../types/layout";
import { SelectionLayer } from "./SelectionLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box: LayoutBox = {
  id: "t1",
  page: 0,
  x: 20,
  y: 20,
  w: 40,
  h: 12,
  rotation: 0,
  bounds: { x: 20, y: 20, w: 40, h: 12 },
  line: null,
  overflow: 0,
};

/** Dos líneas de tres glifos de 5 mm. */
const glyphs: Glyph[] = [0, 1, 2, 4, 5, 6].map((text_index, at) => {
  const line = at < 3 ? 0 : 1;
  return {
    page: 0,
    text_index,
    line,
    x: 20 + (at % 3) * 5,
    y: 20 + line * 6,
    width: 5,
    line_height: 5,
    baseline: 24 + line * 6,
  };
});

const page = { width: 210, height: 297, unit: "mm" as const };
const viewport = { width: 800, height: 600 };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useEditingStore.setState(useEditingStore.getInitialState(), true);
  useEditingStore.getState().edit("t1", 0);
  useEditingStore.getState().setGlyphs(glyphs);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(zoom = 1, rotation = 0) {
  const transform = canvasTransform(viewport, page, zoom, { x: 0, y: 0 });
  act(() => root.render(<SelectionLayer box={{ ...box, rotation }} transform={transform} />));
}

const rects = () => [...container.querySelectorAll<HTMLElement>(".text-selection")];

describe("lo seleccionado dentro de un texto", () => {
  it("cubre los glifos elegidos", () => {
    act(() => useEditingStore.getState().select(1, 3));
    render();
    expect(rects()).toHaveLength(1);
    expect(rects()[0]?.style.left).toBe(`${5 * PX_PER_MM}px`);
    expect(rects()[0]?.style.width).toBe(`${10 * PX_PER_MM}px`);
    expect(rects()[0]?.style.height).toBe(`${5 * PX_PER_MM}px`);
  });

  it("de varias líneas, un rectángulo por línea", () => {
    act(() => useEditingStore.getState().select(1, 6));
    render();
    expect(rects()).toHaveLength(2);
    expect(rects()[1]?.style.top).toBe(`${6 * PX_PER_MM}px`);
  });

  it("a cualquier zoom sigue cuadrando", () => {
    act(() => useEditingStore.getState().select(0, 2));
    render(2);
    expect(rects()[0]?.style.width).toBe(`${10 * PX_PER_MM * 2}px`);
  });

  it("gira con el elemento", () => {
    act(() => useEditingStore.getState().select(0, 2));
    render(1, 30);
    expect(container.querySelector<HTMLElement>(".text-selection-layer")?.style.transform).toContain(
      "rotate(30deg)",
    );
  });

  it("sin nada seleccionado no se dibuja nada", () => {
    render();
    expect(rects()).toHaveLength(0);
  });
});
