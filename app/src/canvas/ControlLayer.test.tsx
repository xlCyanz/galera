import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { HANDLE_SIZE, ROTATE_HANDLE_OFFSET, resizeCursor } from "./handleGeometry";
import { canvasTransform, rectToCanvas } from "./transform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => new Promise(() => undefined),
};

const page = { width: 210, height: 297, unit: "mm" } as const;
const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [{ id: "p1", size: page, elements: [] }],
  },
};

const AREA = { width: 900, height: 700 };

function box(overrides: Partial<LayoutBox> = {}): LayoutBox {
  const base = { x: 30, y: 40, w: 60, h: 25 };
  return {
    id: "r1",
    page: 0,
    ...base,
    rotation: 0,
    bounds: base,
    line: null,
    overflow: 0,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let hitTests: number;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => AREA.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => AREA.height });
  hitTests = 0;
  mockIPC((command) => {
    if (command === "element_at") {
      hitTests += 1;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Canvas loader={loader} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

function select(layoutBox: LayoutBox) {
  act(() => useLayoutStore.getState().update(1, [layoutBox]));
  act(() => useDocumentStore.getState().select(layoutBox.id));
}

const layer = () => container.querySelector<HTMLElement>(".control-layer");
const handle = (name: string) => container.querySelector<HTMLElement>(`[data-handle="${name}"]`);

/** Lee `translate(x, y)` y `rotate(r)` de un estilo. */
function placement(element: HTMLElement) {
  const t = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) rotate\((-?[\d.e+-]+)deg\)/.exec(
    element.style.transform,
  );
  return { left: Number(t?.[1]), top: Number(t?.[2]), rotation: Number(t?.[3]) };
}

describe("capa de controles", () => {
  it("sin selección no hay nada", () => {
    expect(layer()).toBeNull();
  });

  it("el contorno es la caja del layout, a cualquier zoom", () => {
    select(box());
    for (const zoom of [0.25, 0.5, 1, 3, 8]) {
      act(() => useDocumentStore.getState().setView(zoom, { x: 12, y: -30 }));
      const expected = rectToCanvas(canvasTransform(AREA, page, zoom, { x: 12, y: -30 }), box());
      const at = placement(layer()!);
      expect(at.left).toBeCloseTo(expected.left, 6);
      expect(at.top).toBeCloseTo(expected.top, 6);
      expect(parseFloat(layer()!.style.width)).toBeCloseTo(expected.width, 6);
      expect(parseFloat(layer()!.style.height)).toBeCloseTo(expected.height, 6);
    }
  });

  it("ocho manejadores en esquinas y lados, y uno de rotación encima del borde superior", () => {
    select(box());
    const handles = [...container.querySelectorAll<HTMLElement>(".handle")].map((h) => h.dataset.handle);
    expect(handles.sort()).toEqual(["e", "n", "ne", "nw", "rotate", "s", "se", "sw", "w"]);

    const { width, height } = layer()!.style;
    const w = parseFloat(width);
    const h = parseFloat(height);
    const center = (name: string) => {
      const style = handle(name)!.style;
      return { x: parseFloat(style.left) + HANDLE_SIZE / 2, y: parseFloat(style.top) + HANDLE_SIZE / 2 };
    };
    expect(center("nw")).toEqual({ x: 0, y: 0 });
    expect(center("se").x).toBeCloseTo(w, 6);
    expect(center("se").y).toBeCloseTo(h, 6);
    expect(center("e").y).toBeCloseTo(h / 2, 6);
    expect(center("rotate").x).toBeCloseTo(w / 2, 6);
    expect(center("rotate").y).toBe(-ROTATE_HANDLE_OFFSET);
  });

  it("los manejadores miden lo mismo en pantalla a cualquier zoom", () => {
    select(box());
    for (const zoom of [0.25, 1, 8]) {
      act(() => useDocumentStore.getState().setZoom(zoom));
      for (const h of container.querySelectorAll<HTMLElement>(".handle")) {
        expect(h.style.width).toBe(`${HANDLE_SIZE}px`);
        expect(h.style.height).toBe(`${HANDLE_SIZE}px`);
      }
    }
  });

  it("un elemento girado gira su capa, y los cursores siguen la dirección en pantalla", () => {
    select(box({ rotation: 30 }));
    expect(placement(layer()!).rotation).toBe(30);
    expect(layer()!.style.transformOrigin).toBe("center");

    expect(handle("n")!.style.cursor).toBe(resizeCursor("n", 30));
    expect(handle("n")!.style.cursor).toBe("nesw-resize");
    expect(handle("e")!.style.cursor).toBe("nwse-resize");

    select(box({ rotation: 90 }));
    expect(handle("n")!.style.cursor).toBe("ew-resize");
  });

  it("una línea lleva un manejador en cada extremo, sin contorno ni rotación", () => {
    select(
      box({
        id: "l1",
        x: 20,
        y: 40,
        w: 170,
        h: 80,
        line: { x1: 190, y1: 120, x2: 20, y2: 40 },
      }),
    );
    expect(layer()!.classList.contains("is-line")).toBe(true);
    const handles = [...container.querySelectorAll<HTMLElement>(".handle")].map((h) => h.dataset.handle);
    expect(handles).toEqual(["start", "end"]);

    const scale = parseFloat(layer()!.style.width) / 170;
    const start = handle("start")!.style;
    expect(parseFloat(start.left) + HANDLE_SIZE / 2).toBeCloseTo(170 * scale, 6);
    expect(parseFloat(start.top) + HANDLE_SIZE / 2).toBeCloseTo(80 * scale, 6);
  });

  it("pulsar un manejador no llega al lienzo: ni pregunta al núcleo ni deselecciona", async () => {
    select(box());
    await act(async () => {
      handle("se")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(hitTests).toBe(0);
    expect(useDocumentStore.getState().selectedElement).toBe("r1");
  });

  it("solo en la página del elemento", () => {
    select(box({ page: 1 }));
    expect(layer()).toBeNull();
  });
});
