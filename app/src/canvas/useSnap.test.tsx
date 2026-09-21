import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox, MmRect } from "../types/layout";
import type { Grips, Snapped } from "../types/snap";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { PX_PER_MM } from "./geometry";

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
          { type: "rect", id: "r2", x: 120, y: 40, w: 40, h: 20, rotation: 0, fill: "#00ff00", stroke: null, radius: 0 },
        ],
      },
    ],
  },
};

const box = (id: string, x: number, y: number, w: number, h: number): LayoutBox => ({
  id, page: 0, x, y, w, h, rotation: 0, bounds: { x, y, w, h }, line: null, overflow: 0,
});

/** Lo que engancha el núcleo de mentira: 1 mm a la derecha, con su guía. */
const SNAP_MM = 1;

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;
let asked: Array<{ ids: string[]; rect: MmRect; grips: Grips }>;
/** Si el núcleo de mentira engancha algo, o contesta que no hay nada. */
let snaps: boolean;

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
  asked = [];
  snaps = true;
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
    if (command === "snap") {
      const asking = args as unknown as { ids: string[]; rect: MmRect; grips: Grips };
      asked.push(asking);
      const rect = asking.rect;
      if (!snaps) {
        const nothing: Snapped = { dx: 0, dy: 0, rect, guides: [] };
        return nothing;
      }
      const snapped: Snapped = {
        dx: SNAP_MM,
        dy: 0,
        rect: { ...rect, x: rect.x + SNAP_MM, w: rect.w + SNAP_MM },
        guides: [{ line: { x1: 120, y1: 10, x2: 120, y2: 90 }, kind: "element" }],
      };
      return snapped;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  const boxes = [box("r1", 30, 40, 60, 20), box("r2", 120, 40, 40, 20)];
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

const restore: Array<() => void> = [];

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  while (restore.length > 0) restore.pop()?.();
});

const layer = () => container.querySelector<HTMLElement>(".control-layer")!;
const handle = (name: string) => container.querySelector<HTMLElement>(`[data-handle="${name}"]`)!;
const guides = () => [...container.querySelectorAll(".snap-guide")];

/** Lee `translate(x, y)` de un estilo. */
function translate(element: HTMLElement) {
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(element.style.transform);
  return { x: Number(match?.[1]), y: Number(match?.[2]) };
}

function select(id: string) {
  act(() => useDocumentStore.getState().select(id));
}

function press(target: HTMLElement, x: number, y: number) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
    );
  });
}

function moveTo(x: number, y: number, init: MouseEventInit = {}) {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, ...init }));
  });
}

/** Deja que llegue la respuesta del núcleo. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function release() {
  act(() => window.dispatchEvent(new MouseEvent("pointerup")));
  await settle();
}

describe("el ajuste al arrastrar", () => {
  it("pregunta al núcleo por la caja que se ve, con la caja entera agarrada", async () => {
    select("r1");
    press(layer(), 400, 300);
    moveTo(400 + 10 * PX_PER_MM, 300);
    await settle();

    expect(asked).not.toHaveLength(0);
    const last = asked.at(-1)!;
    expect(last.ids).toEqual(["r1"]);
    expect(last.grips).toEqual({ x: "whole", y: "whole" });
    // La caja del elemento movida 10 mm: 30 + 10.
    expect(last.rect.x).toBeCloseTo(40, 6);
    expect(last.rect.y).toBeCloseTo(40, 6);
    expect(last.rect.w).toBe(60);
  });

  /** El criterio de la tarea: las guías salen durante el arrastre. */
  it("cuando contesta, el elemento se engancha y salen sus guías", async () => {
    select("r1");
    const before = translate(layer());
    press(layer(), 400, 300);
    moveTo(400 + 10 * PX_PER_MM, 300);

    // Antes de la respuesta, el elemento va donde el ratón y no hay guías.
    expect(translate(layer()).x - before.x).toBeCloseTo(10 * PX_PER_MM, 6);
    expect(guides()).toHaveLength(0);

    await settle();
    expect(translate(layer()).x - before.x).toBeCloseTo((10 + SNAP_MM) * PX_PER_MM, 6);
    expect(guides()).toHaveLength(1);
  });

  it("al soltar se manda lo que se veía, con el enganche dentro", async () => {
    select("r1");
    press(layer(), 400, 300);
    moveTo(400 + 10 * PX_PER_MM, 300);
    await settle();
    await release();

    expect(ops).toHaveLength(1);
    expect(ops[0]!.op).toBe("move");
    expect(ops[0]!.dx).toBeCloseTo(10 + SNAP_MM, 3);
  });

  /** El criterio de la tarea: las guías desaparecen al soltar. */
  it("al soltar no quedan guías", async () => {
    select("r1");
    press(layer(), 400, 300);
    moveTo(400 + 10 * PX_PER_MM, 300);
    await settle();
    expect(guides()).toHaveLength(1);

    await release();
    expect(guides()).toHaveLength(0);
  });

  /** El criterio de la tarea: una tecla desactiva el ajuste mientras dure. */
  it("con ⌘ no se pregunta, no se engancha y no hay guías", async () => {
    select("r1");
    const before = translate(layer());
    press(layer(), 400, 300);
    moveTo(400 + 10 * PX_PER_MM, 300, { metaKey: true });
    await settle();

    expect(asked).toHaveLength(0);
    expect(translate(layer()).x - before.x).toBeCloseTo(10 * PX_PER_MM, 6);
    expect(guides()).toHaveLength(0);

    // Al soltarla vuelve a ajustar.
    moveTo(400 + 12 * PX_PER_MM, 300);
    await settle();
    expect(asked).toHaveLength(1);
    expect(guides()).toHaveLength(1);
  });

  it("si el núcleo dice que no hay nada, el elemento se queda donde el ratón", async () => {
    snaps = false;
    select("r1");
    const before = translate(layer());
    press(layer(), 400, 300);
    moveTo(400 + 10 * PX_PER_MM, 300);
    await settle();

    expect(translate(layer()).x - before.x).toBeCloseTo(10 * PX_PER_MM, 6);
    expect(guides()).toHaveLength(0);
  });

  it("una respuesta que llega tarde no mueve el elemento a donde ya no está", async () => {
    select("r1");
    const before = translate(layer());
    press(layer(), 400, 300);
    moveTo(400 + 10 * PX_PER_MM, 300);
    await settle();
    expect(guides()).toHaveLength(1);

    // El ratón sigue antes de que conteste: lo que hay contestado es de la
    // posición de antes, así que no se aplica ni se enseña.
    moveTo(400 + 20 * PX_PER_MM, 300);
    expect(translate(layer()).x - before.x).toBeCloseTo(20 * PX_PER_MM, 6);
    expect(guides()).toHaveLength(0);
  });
});

describe("el ajuste al redimensionar", () => {
  /** El criterio de la tarea: funciona igual al mover y al redimensionar. */
  it("pregunta por el borde del manejador, no por la caja entera", async () => {
    select("r1");
    press(handle("e"), 500, 300);
    moveTo(500 + 10 * PX_PER_MM, 300);
    await settle();

    const last = asked.at(-1)!;
    expect(last.grips).toEqual({ x: "end", y: "none" });
    expect(last.rect.w).toBeCloseTo(70, 6);
    expect(last.rect.x).toBeCloseTo(30, 6);
  });

  it("la caja que se ve es la que devuelve el núcleo, y salen sus guías", async () => {
    select("r1");
    press(handle("e"), 500, 300);
    moveTo(500 + 10 * PX_PER_MM, 300);
    await settle();

    // 60 + 10 estirados + 1 enganchado.
    expect(parseFloat(layer().style.width)).toBeCloseTo((60 + 10 + SNAP_MM) * PX_PER_MM, 6);
    expect(guides()).toHaveLength(1);
    await release();
    expect(ops[0]!.w).toBeCloseTo(60 + 10 + SNAP_MM, 3);
  });

  it("con la proporción fija o desde el centro no se ajusta", async () => {
    select("r1");
    press(handle("e"), 500, 300);
    moveTo(500 + 10 * PX_PER_MM, 300, { shiftKey: true });
    await settle();
    expect(asked).toHaveLength(0);

    moveTo(500 + 10 * PX_PER_MM, 300, { altKey: true });
    await settle();
    expect(asked).toHaveLength(0);
  });
});
