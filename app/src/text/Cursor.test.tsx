import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canvasTransform } from "../canvas/transform";
import { PX_PER_MM } from "../canvas/geometry";
import { useEditingStore } from "../store/editing";
import type { Glyph, LayoutBox } from "../types/layout";
import { Cursor } from "./Cursor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box: LayoutBox = {
  id: "t1",
  page: 0,
  x: 20,
  y: 20,
  w: 80,
  h: 12,
  rotation: 0,
  bounds: { x: 20, y: 20, w: 80, h: 12 },
  line: null,
  overflow: 0,
};

/** Dos líneas de tres glifos de 5 mm. */
const glyphs: Glyph[] = [0, 1, 2, 4, 5, 6].map((text_index, at) => {
  const line = at < 3 ? 0 : 1;
  return {
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

function render(zoom = 1) {
  const transform = canvasTransform(viewport, page, zoom, { x: 0, y: 0 });
  act(() => root.render(<Cursor box={box} transform={transform} />));
  return transform;
}

const cursor = () => container.querySelector<HTMLElement>(".text-cursor");
const layer = () => container.querySelector<HTMLElement>(".text-cursor-layer");

describe("el cursor de texto", () => {
  it("se pone donde dice el glifo, no donde lo estime la interfaz", () => {
    render();
    // El primer glifo empieza en el borde del elemento.
    expect(cursor()?.style.left).toBe("0px");
    expect(cursor()?.style.top).toBe("0px");
    expect(cursor()?.style.height).toBe(`${5 * PX_PER_MM}px`);

    act(() => useEditingStore.getState().setSelection(2, 2));
    expect(cursor()?.style.left).toBe(`${10 * PX_PER_MM}px`);
  });

  it("al final del texto va detrás del último glifo", () => {
    render();
    act(() => useEditingStore.getState().setSelection(7, 7));
    expect(cursor()?.style.left).toBe(`${15 * PX_PER_MM}px`);
    expect(cursor()?.style.top).toBe(`${6 * PX_PER_MM}px`);
  });

  it("en la línea siguiente baja lo que diga el layout", () => {
    render();
    act(() => useEditingStore.getState().setSelection(4, 4));
    expect(cursor()?.style.top).toBe(`${6 * PX_PER_MM}px`);
    expect(cursor()?.style.left).toBe("0px");
  });

  it("a cualquier zoom sigue cuadrando con el texto", () => {
    render(2);
    act(() => useEditingStore.getState().setSelection(2, 2));
    expect(cursor()?.style.left).toBe(`${10 * PX_PER_MM * 2}px`);
    expect(cursor()?.style.height).toBe(`${5 * PX_PER_MM * 2}px`);
  });

  it("gira con el elemento", () => {
    useEditingStore.getState().setSelection(0, 0);
    const transform = canvasTransform(viewport, page, 1, { x: 0, y: 0 });
    act(() => root.render(<Cursor box={{ ...box, rotation: 30 }} transform={transform} />));
    expect(layer()?.style.transform).toContain("rotate(30deg)");
  });

  it("deja de parpadear al escribir: la animación empieza de nuevo", () => {
    render();
    const before = cursor();
    act(() => useEditingStore.getState().typed());
    // Se vuelve a montar: otro elemento, con la animación desde el principio.
    expect(cursor()).not.toBe(before);
  });

  it("sin glifos no se dibuja nada", () => {
    act(() => useEditingStore.getState().setGlyphs([]));
    render();
    expect(cursor()).toBeNull();
  });
});
