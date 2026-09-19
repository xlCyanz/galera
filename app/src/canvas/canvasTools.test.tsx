import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { useToolStore } from "../store/tool";
import type { LayoutBox } from "../types/layout";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => new Promise(() => undefined),
};

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
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] }],
  },
};

const box: LayoutBox = {
  id: "r1", page: 0, x: 30, y: 40, w: 60, h: 25, rotation: 0, bounds: { x: 30, y: 40, w: 60, h: 25 }, line: null,
};

let container: HTMLDivElement;
let root: Root;
let hitTests: number;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 700 });
  // jsdom no implementa la captura del puntero.
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
  hitTests = 0;
  mockIPC((command) => {
    if (command === "element_at") {
      hitTests += 1;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useToolStore.setState(useToolStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useLayoutStore.getState().update(1, [box]);
  useDocumentStore.getState().select("r1");
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
  delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture;
});

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const layer = () => container.querySelector<HTMLElement>(".control-layer")!;

function tool(name: Parameters<ReturnType<typeof useToolStore.getState>["setTool"]>[0]) {
  act(() => useToolStore.getState().setTool(name));
}

function pointer(type: string, clientX: number, clientY: number, target: HTMLElement = viewport()) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("la herramienta activa en el lienzo", () => {
  it("cambia el cursor del lienzo", () => {
    expect(viewport().dataset.tool).toBe("select");
    tool("rect");
    expect(viewport().dataset.tool).toBe("rect");
    tool("hand");
    expect(viewport().className).toContain("is-pan-ready");
  });

  it("con la de selección, un clic pregunta qué elemento hay debajo", async () => {
    pointer("pointerdown", 100, 100);
    await settle();
    expect(hitTests).toBe(1);
  });

  it("con la mano, arrastrar desplaza la página y no selecciona", async () => {
    tool("hand");
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 160, 130);
    pointer("pointerup", 160, 130);
    await settle();
    expect(useDocumentStore.getState().scroll).toEqual({ x: 60, y: 30 });
    expect(hitTests).toBe(0);
    expect(useDocumentStore.getState().selectedElement).toBe("r1");
  });

  it("con una que crea elementos, el clic no selecciona ni arrastra lo seleccionado", async () => {
    tool("ellipse");
    expect(layer().className).toContain("is-inert");
    pointer("pointerdown", 100, 100);
    await settle();
    expect(hitTests).toBe(0);
    expect(useDocumentStore.getState().selectedElement).toBe("r1");
  });

  it("Escape vuelve a la de selección sin deseleccionar; otro Escape deselecciona", () => {
    tool("line");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    expect(useToolStore.getState().tool).toBe("select");
    expect(useDocumentStore.getState().selectedElement).toBe("r1");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    expect(useDocumentStore.getState().selectedElement).toBeNull();
  });
});

describe("un elemento bloqueado seleccionado desde el panel", () => {
  it("enseña el contorno, pero no se agarra ni se empuja con las flechas", async () => {
    act(() => {
      const document = structuredClone(project.document);
      document.pages[0]!.elements.push({ type: "rect", id: "r1", x: 30, y: 40, w: 60, h: 25, rotation: 0, fill: null, stroke: null, radius: 0, locked: true });
      useDocumentStore.getState().replaceDocument(document);
      useDocumentStore.getState().select("r1");
    });
    expect(layer().className).toContain("is-inert");
    let moved = 0;
    mockIPC((command) => {
      if (command === "apply_op") {
        moved += 1;
      }
      return null;
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
    });
    await settle();
    expect(moved).toBe(0);
  });
});
