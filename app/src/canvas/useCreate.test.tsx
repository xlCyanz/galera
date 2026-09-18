import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { useToolStore } from "../store/tool";
import type { Element } from "../types/model";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { DEFAULT_SIZE } from "./createGeometry";
import { PX_PER_MM } from "./geometry";
import { canvasTransform, toCanvas } from "./transform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => Promise.resolve(),
};

const AREA = { width: 1000, height: 600 };
const size = { width: 200, height: 100, unit: "mm" } as const;
const project: OpenedProject = {
  root: "/p",
  revision: 1,
  document: { version: 1, meta: { title: "x" }, fonts: [], assets: {}, variables: {}, pages: [{ id: "p1", size, elements: [] }] },
};

let container: HTMLDivElement;
let root: Root;
let ops: Array<{ op: string; page: string; index: number | null; element: Element }>;

beforeEach(async () => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => AREA.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => AREA.height });
  ops = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      const op = (args as { op: (typeof ops)[number] }).op;
      ops.push(op);
      const document = structuredClone(project.document);
      document.pages[0]!.elements.push(op.element);
      const applied: AppliedOp = { revision: 1 + ops.length, document, description: `Crear ${op.element.id}`, undo: `Crear ${op.element.id}`, redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useToolStore.setState(useToolStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useCompilationStore.getState().finish({ revision: 1, ms: 1, reused: false, diagnostics: [], pages: ["<svg/>"], boxes: [] });
  useLayoutStore.getState().update(1, []);

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

/** Un punto de la página, en mm, en la pantalla (el área está en el origen en jsdom). */
function screen(x: number, y: number) {
  const { zoom, scroll } = useDocumentStore.getState();
  return toCanvas(canvasTransform(AREA, size, zoom, scroll), x, y);
}

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const preview = () => container.querySelector<HTMLElement>(".create-preview");

function down(x: number, y: number) {
  const at = screen(x, y);
  act(() => {
    viewport().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: at.x, clientY: at.y }));
  });
}

function move(x: number, y: number, init: MouseEventInit = {}) {
  const at = screen(x, y);
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: at.x, clientY: at.y, ...init }));
  });
}

async function up() {
  await act(async () => {
    window.dispatchEvent(new MouseEvent("pointerup"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function tool(name: "rect" | "ellipse" | "line") {
  act(() => useToolStore.getState().setTool(name));
}

describe("crear formas", () => {
  it("el arrastre enseña la forma antes de crearla", () => {
    tool("rect");
    down(20, 30);
    move(60, 55);
    expect(ops).toHaveLength(0);
    expect(preview()!.dataset.shape).toBe("rect");
    expect(parseFloat(preview()!.style.width)).toBeCloseTo(40 * PX_PER_MM * useDocumentStore.getState().zoom, 6);
  });

  it("al soltar se crea con un único comando, queda seleccionada y se vuelve a la selección", async () => {
    tool("rect");
    down(20, 30);
    move(60, 55);
    await up();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "create", page: "p1", index: null });
    expect(ops[0]!.element).toMatchObject({ type: "rect", id: "rect-1", x: 20, y: 30, w: 40, h: 25, fill: "#cbd5e1" });
    expect(useDocumentStore.getState().selectedElement).toBe("rect-1");
    expect(useToolStore.getState().tool).toBe("select");
    expect(useDocumentStore.getState().history.undo).toBe("Crear rect-1");

    // La vista previa se queda hasta que llega lo compilado con el elemento.
    expect(preview()).not.toBeNull();
    act(() => useLayoutStore.getState().update(2, []));
    expect(preview()).toBeNull();
  });

  it("un clic sin arrastrar crea el tamaño por defecto", async () => {
    tool("ellipse");
    down(20, 30);
    await up();
    expect(ops[0]!.element).toMatchObject({ type: "ellipse", x: 20, y: 30, ...DEFAULT_SIZE.ellipse });
  });

  it("Shift fuerza un círculo y una línea a 45°", async () => {
    tool("ellipse");
    down(20, 30);
    move(60, 40, { shiftKey: true });
    await up();
    expect(ops[0]!.element).toMatchObject({ w: 40, h: 40 });

    tool("line");
    down(10, 10);
    move(40, 12, { shiftKey: true });
    await up();
    const line = ops[1]!.element;
    expect(line).toMatchObject({ type: "line", id: "line-1", x: 10, y: 10, y2: 10 });
    expect(line.type === "line" && line.stroke).toEqual({ color: "#1f2733", width: 0.5 });
  });

  it("Esc cancela sin crear nada y sin cambiar de herramienta", async () => {
    tool("rect");
    down(20, 30);
    move(60, 55);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    await up();
    expect(ops).toHaveLength(0);
    expect(preview()).toBeNull();
    expect(useToolStore.getState().tool).toBe("rect");
  });

  it("con la herramienta de selección, arrastrar no crea nada", async () => {
    down(20, 30);
    move(60, 55);
    await up();
    expect(ops).toHaveLength(0);
  });
});
