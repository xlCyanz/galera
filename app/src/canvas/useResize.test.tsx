import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { PX_PER_MM } from "./geometry";
import { MIN_SIZE_MM } from "./resizeGeometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => Promise.resolve(),
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
    pages: [
      {
        id: "p1",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [
          { type: "rect", id: "r1", x: 30, y: 40, w: 60, h: 20, rotation: 0, fill: "#ff0000", stroke: null, radius: 0 },
          {
            type: "text", id: "t1", x: 100, y: 10, w: 50, h: null, rotation: 0,
            content: [{ text: "Hola", bold: false, italic: false, underline: false }],
            style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
          },
        ],
      },
    ],
  },
};

const box = (id: string, x: number, y: number, w: number, h: number): LayoutBox => ({
  id, page: 0, x, y, w, h, rotation: 0, bounds: { x, y, w, h }, line: null, overflow: 0,
});

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;

beforeEach(async () => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  ops = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      ops.push((args as { op: Record<string, unknown> }).op);
      const applied: AppliedOp = { revision: 1 + ops.length, document: structuredClone(project.document), description: "", undo: null, redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  const boxes = [box("r1", 30, 40, 60, 20), box("t1", 100, 10, 50, 7.5)];
  useCompilationStore.getState().finish({ revision: 1, ms: 1, reused: false, diagnostics: [], keys: [], pages: ["<svg/>"], boxes, flows: [], cells: [] });
  useLayoutStore.getState().update(1, boxes);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Canvas loader={loader} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

const layer = () => container.querySelector<HTMLElement>(".control-layer")!;
const handle = (name: string) => container.querySelector<HTMLElement>(`[data-handle="${name}"]`)!;
const label = () => container.querySelector(".size-label")?.textContent ?? null;
const width = () => parseFloat(layer().style.width);
const height = () => parseFloat(layer().style.height);

function grab(name: string) {
  act(() => {
    handle(name).dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 500, clientY: 300 }),
    );
  });
}

/** Mueve el puntero `mm` milímetros (a la escala del 100 %) desde donde se agarró. */
function pull(dxMm: number, dyMm: number, init: MouseEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 500 + dxMm * PX_PER_MM, clientY: 300 + dyMm * PX_PER_MM, ...init }),
    );
  });
}

async function release() {
  await act(async () => {
    window.dispatchEvent(new MouseEvent("pointerup"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function select(id: string) {
  act(() => useDocumentStore.getState().select(id));
}

describe("redimensionar con los manejadores", () => {
  it("se ve en vivo, con sus medidas, sin mandar nada al núcleo", () => {
    select("r1");
    expect(label()).toBeNull();
    grab("se");
    pull(10, 5);
    expect(ops).toHaveLength(0);
    expect(width()).toBeCloseTo(70 * PX_PER_MM, 6);
    expect(height()).toBeCloseTo(25 * PX_PER_MM, 6);
    expect(label()).toBe("70 × 25 mm");
  });

  it("al soltar manda un único Resize anclado en la esquina opuesta, y la vista previa espera a lo compilado", async () => {
    select("r1");
    grab("nw");
    pull(-10, -5);
    await release();

    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.op).toBe("resize");
    expect(op.x as number).toBeCloseTo(20, 9);
    expect(op.y as number).toBeCloseTo(35, 9);
    expect(op.w as number).toBeCloseTo(70, 9);
    expect(op.h as number).toBeCloseTo(25, 9);

    // Hasta que llegan las cajas nuevas, el contorno sigue con la caja nueva.
    expect(width()).toBeCloseTo(70 * PX_PER_MM, 6);
    expect(label()).toBeNull();
    act(() => useLayoutStore.getState().update(2, [box("r1", 20, 35, 70, 25)]));
    expect(width()).toBeCloseTo(70 * PX_PER_MM, 6);
  });

  it("Esc cancela y todo vuelve a su sitio", async () => {
    select("r1");
    grab("e");
    pull(30, 0);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    await release();
    expect(ops).toHaveLength(0);
    expect(width()).toBeCloseTo(60 * PX_PER_MM, 6);
    expect(useDocumentStore.getState().selection).toEqual(["r1"]);
  });

  it("Shift mantiene la proporción y Alt redimensiona desde el centro", async () => {
    select("r1");
    grab("se");
    pull(30, 0, { shiftKey: true });
    await release();
    expect(ops[0]).toMatchObject({ w: 90, h: 30 });

    grab("e");
    pull(5, 0, { altKey: true });
    await release();
    const fromCenter = ops[1]!;
    expect(fromCenter.w as number).toBeCloseTo(70, 9);
    expect(fromCenter.x as number).toBeCloseTo(25, 9);
  });

  it("nunca deja un ancho ni un alto negativos", async () => {
    select("r1");
    grab("se");
    pull(-500, -500);
    expect(width()).toBeCloseTo(MIN_SIZE_MM * PX_PER_MM, 6);
    await release();
    expect(ops[0]).toMatchObject({ w: MIN_SIZE_MM, h: MIN_SIZE_MM });
  });

  it("en un texto con alto automático, los laterales solo cambian el ancho y el de abajo fija el alto", async () => {
    select("t1");
    grab("e");
    pull(10, 7);
    await release();
    expect(ops[0]).toMatchObject({ op: "resize", id: "t1", w: 60, h: null });

    grab("s");
    pull(0, 10);
    await release();
    expect(ops[1]!.h as number).toBeCloseTo(17.5, 9);
  });

  it("pulsar un manejador y soltar sin mover no es un cambio, ni deselecciona", async () => {
    select("r1");
    grab("n");
    await release();
    expect(ops).toHaveLength(0);
    expect(useDocumentStore.getState().selection).toEqual(["r1"]);
  });
});
