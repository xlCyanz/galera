import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox, MmRect } from "../types/layout";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { PX_PER_MM } from "./geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => Promise.resolve(),
};

/** Dos rectángulos, uno a cada lado de la página. */
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
          { type: "rect", id: "r1", x: 10, y: 10, w: 40, h: 20, rotation: 0, fill: "#ff0000", stroke: null, radius: 0 },
          { type: "rect", id: "r2", x: 100, y: 50, w: 40, h: 20, rotation: 0, fill: "#00ff00", stroke: null, radius: 0 },
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
let scaled: Array<{ ids: string[]; from: MmRect; to: MmRect }>;
/** Lo que contesta `element_at`: qué hay bajo el clic. */
let hit: string | null;
/** Lo que contesta `elements_in`: lo que coge el rectángulo. */
let taken: string[];
const restore: Array<() => void> = [];

beforeEach(async () => {
  const proto = HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("canvas-viewport") ? new DOMRect(0, 0, 1000, 600) : original.call(this);
  };
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 1000 });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 600 });
  restore.push(() => {
    proto.getBoundingClientRect = original;
    delete (proto as { clientWidth?: number }).clientWidth;
    delete (proto as { clientHeight?: number }).clientHeight;
  });

  ops = [];
  scaled = [];
  hit = null;
  taken = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      ops.push((args as { op: Record<string, unknown> }).op);
      const applied: AppliedOp = {
        revision: 1 + ops.length,
        document: structuredClone(project.document),
        description: "",
        undo: null,
        redo: null,
      };
      return applied;
    }
    if (command === "scale_group") {
      scaled.push(args as unknown as { ids: string[]; from: MmRect; to: MmRect });
      const applied: AppliedOp = {
        revision: 2,
        document: structuredClone(project.document),
        description: "",
        undo: null,
        redo: null,
      };
      return applied;
    }
    if (command === "element_at") {
      return hit;
    }
    if (command === "elements_in") {
      return taken;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  const boxes = [box("r1", 10, 10, 40, 20), box("r2", 100, 50, 40, 20)];
  useCompilationStore
    .getState()
    .finish({ revision: 1, ms: 1, reused: false, diagnostics: [], pages: ["<svg/>"], boxes, flows: [], cells: [] });
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
  while (restore.length > 0) restore.pop()?.();
});

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const layers = () => [...container.querySelectorAll<HTMLElement>(".control-layer")];
const marquee = () => container.querySelector<HTMLElement>(".marquee");
const handle = (name: string) => container.querySelector<HTMLElement>(`[data-handle="${name}"]`);
const selection = () => useDocumentStore.getState().selection;

function press(target: HTMLElement, x: number, y: number, init: MouseEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init }),
    );
  });
}

function moveTo(x: number, y: number, init: MouseEventInit = {}) {
  act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, ...init })));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function release() {
  act(() => window.dispatchEvent(new MouseEvent("pointerup")));
  await settle();
}

/** Lee `translate(x, y)` de un estilo. */
function translate(element: HTMLElement) {
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(element.style.transform);
  return { x: Number(match?.[1]), y: Number(match?.[2]) };
}

describe("seleccionar varios elementos", () => {
  /** El criterio de la tarea: ⇧ + clic suma y resta. */
  it("⇧ + clic añade a la selección, y otro ⇧ + clic lo quita", async () => {
    hit = "r1";
    press(viewport(), 100, 100);
    await settle();
    expect(selection()).toEqual(["r1"]);

    hit = "r2";
    press(viewport(), 400, 300, { shiftKey: true });
    await settle();
    expect(selection()).toEqual(["r1", "r2"]);

    press(viewport(), 400, 300, { shiftKey: true });
    await settle();
    expect(selection()).toEqual(["r1"]);
  });

  it("con varios seleccionados se enseña una sola caja, la conjunta, y sin giro", async () => {
    act(() => useDocumentStore.getState().selectMany(["r1", "r2"]));
    await settle();

    expect(layers()).toHaveLength(1);
    const joint = layers()[0]!;
    // De (10,10) a (140,70): 130 × 60 mm.
    expect(parseFloat(joint.style.width)).toBeCloseTo(130 * PX_PER_MM, 6);
    expect(parseFloat(joint.style.height)).toBeCloseTo(60 * PX_PER_MM, 6);
    expect(handle("rotate")).toBeNull();
    expect(handle("se")).not.toBeNull();
  });

  it("pulsar dentro de la selección no la deshace: se arrastra entera", async () => {
    act(() => useDocumentStore.getState().selectMany(["r1", "r2"]));
    hit = "r2";
    press(viewport(), 400, 300);
    await settle();
    expect(selection()).toEqual(["r1", "r2"]);
  });
});

describe("el rectángulo de selección", () => {
  /** El criterio de la tarea: coge los elementos que toca. */
  it("se dibuja al arrastrar en vacío y coge lo que el núcleo diga", async () => {
    hit = null;
    taken = ["r1", "r2"];
    press(viewport(), 100, 100);
    await settle();
    moveTo(400, 300);
    expect(marquee()).not.toBeNull();

    await release();
    expect(selection()).toEqual(["r1", "r2"]);
    expect(marquee()).toBeNull();
  });

  it("un clic en vacío sin arrastrar no pregunta nada y deselecciona", async () => {
    act(() => useDocumentStore.getState().selectMany(["r1", "r2"]));
    hit = null;
    taken = ["r1"];
    press(viewport(), 100, 100);
    await settle();
    await release();

    expect(selection()).toEqual([]);
  });

  it("con ⇧ suma a lo que ya había", async () => {
    act(() => useDocumentStore.getState().select("r1"));
    hit = null;
    taken = ["r2"];
    press(viewport(), 600, 100, { shiftKey: true });
    await settle();
    moveTo(900, 400);
    await release();

    expect(selection()).toEqual(["r1", "r2"]);
  });

  it("Esc lo cancela y no coge nada", async () => {
    act(() => useDocumentStore.getState().select("r1"));
    hit = null;
    taken = ["r2"];
    // Con ⇧ la selección de antes no se pierde al pulsar en vacío.
    press(viewport(), 600, 100, { shiftKey: true });
    await settle();
    moveTo(900, 400);
    expect(marquee()).not.toBeNull();

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(marquee()).toBeNull();

    await release();
    // r2 no ha entrado: el rectángulo se canceló.
    expect(selection()).toEqual(["r1"]);
  });
});

describe("mover y estirar varios a la vez", () => {
  /** El criterio de la tarea: la caja conjunta mueve todo el grupo. */
  it("arrastrar la caja conjunta manda un solo comando con los dos movimientos", async () => {
    act(() => useDocumentStore.getState().selectMany(["r1", "r2"]));
    await settle();
    const joint = layers()[0]!;
    const before = translate(joint);

    press(joint, 300, 200);
    moveTo(300 + 10 * PX_PER_MM, 200 + 5 * PX_PER_MM);
    expect(translate(layers()[0]!).x - before.x).toBeCloseTo(10 * PX_PER_MM, 6);
    await release();

    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      op: "batch",
      ops: [
        { op: "move", id: "r1", dx: 10, dy: 5 },
        { op: "move", id: "r2", dx: 10, dy: 5 },
      ],
    });
  });

  /** El criterio de la tarea: estirar el grupo lo reparte el núcleo. */
  it("estirar la caja conjunta se lo pide al núcleo con las dos cajas", async () => {
    act(() => useDocumentStore.getState().selectMany(["r1", "r2"]));
    await settle();

    press(handle("se")!, 500, 300);
    moveTo(500 + 13 * PX_PER_MM, 300 + 6 * PX_PER_MM);
    await release();

    // No se manda un redimensionado por elemento.
    expect(ops).toHaveLength(0);
    expect(scaled).toHaveLength(1);
    expect(scaled[0]!.ids).toEqual(["r1", "r2"]);
    expect(scaled[0]!.from).toEqual({ x: 10, y: 10, w: 130, h: 60 });
    expect(scaled[0]!.to.w).toBeCloseTo(143, 3);
    expect(scaled[0]!.to.h).toBeCloseTo(66, 3);
  });
});
