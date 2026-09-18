import { beforeEach, describe, expect, it } from "vitest";

import type { LayoutBox } from "../types/layout";
import { useLayoutStore } from "./layout";

function box(id: string, page = 0, overrides: Partial<LayoutBox> = {}): LayoutBox {
  const rect = { x: 10, y: 20, w: 30, h: 40 };
  return { id, page, ...rect, rotation: 0, bounds: rect, line: null, ...overrides };
}

const store = () => useLayoutStore.getState();

beforeEach(() => {
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
});

describe("store del layout", () => {
  it("guarda las cajas indexadas por id", () => {
    store().update(1, [box("r1"), box("t1", 1)]);
    expect(Object.keys(store().boxes)).toEqual(["r1", "t1"]);
    expect(store().boxes.t1?.page).toBe(1);
    expect(store().revision).toBe(1);
  });

  it("cada compilación sustituye las cajas: las de elementos que ya no están desaparecen", () => {
    store().update(1, [box("r1"), box("t1")]);
    store().update(2, [box("r1", 0, { x: 99 })]);
    expect(store().boxes).toEqual({ r1: box("r1", 0, { x: 99 }) });
  });

  it("las de una revisión anterior llegan tarde y se ignoran", () => {
    store().update(3, [box("nuevo")]);
    store().update(2, [box("viejo")]);
    expect(Object.keys(store().boxes)).toEqual(["nuevo"]);
  });

  it("al abrir otro documento se olvidan, salvo que ya hayan llegado las suyas", () => {
    store().update(1, [box("anterior")]);
    store().expect(2);
    expect(store().boxes).toEqual({});
    store().update(1, [box("anterior")]);
    expect(store().boxes).toEqual({});

    store().update(3, [box("nuevo")]);
    store().expect(3);
    expect(Object.keys(store().boxes)).toEqual(["nuevo"]);
  });
});
