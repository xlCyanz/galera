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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Decodifica al momento, para que haya imagen que arrastrar. */
const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => Promise.resolve(),
};

const project: OpenedProject = {
  root: "/p",
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
          { type: "rect", id: "r1", x: 30, y: 40, w: 60, h: 25, rotation: 0, fill: "#ff0000", stroke: null, radius: 0 },
        ],
      },
    ],
  },
};

const r1: LayoutBox = {
  id: "r1",
  page: 0,
  x: 30,
  y: 40,
  w: 60,
  h: 25,
  rotation: 0,
  bounds: { x: 30, y: 40, w: 60, h: 25 },
  line: null,
};

const AREA = { left: 0, top: 0, width: 1000, height: 600 };

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;
let hit: string | null;
const restore: Array<() => void> = [];

beforeEach(async () => {
  const proto = HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("canvas-viewport")
      ? new DOMRect(AREA.left, AREA.top, AREA.width, AREA.height)
      : original.call(this);
  };
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => AREA.width });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => AREA.height });
  restore.push(() => {
    proto.getBoundingClientRect = original;
    delete (proto as { clientWidth?: number }).clientWidth;
    delete (proto as { clientHeight?: number }).clientHeight;
  });

  ops = [];
  hit = null;
  mockIPC((command, args) => {
    if (command === "apply_op") {
      const op = (args as { op: Record<string, unknown> }).op;
      ops.push(op);
      const applied: AppliedOp = {
        revision: 1 + ops.length,
        document: structuredClone(project.document),
        description: `Mover ${String(op.id)}`,
      };
      return applied;
    }
    if (command === "element_at") {
      return hit;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useCompilationStore
    .getState()
    .finish({ revision: 1, ms: 1, reused: false, diagnostics: [], pages: ["<svg>pagina</svg>"], boxes: [r1] });
  useLayoutStore.getState().update(1, [r1]);

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

const layer = () => container.querySelector<HTMLElement>(".control-layer");
const ghost = () => container.querySelector<HTMLElement>(".drag-ghost");

/** Lee `translate(x, y)` de un estilo. */
function translate(element: HTMLElement | null) {
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(element?.style.transform ?? "");
  return { x: Number(match?.[1]), y: Number(match?.[2]) };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function press(target: HTMLElement, x: number, y: number, init: MouseEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init }),
    );
  });
}

function moveTo(x: number, y: number, init: MouseEventInit = {}) {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y, ...init }));
  });
}

async function release(x: number, y: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y }));
  });
  await settle();
}

function select() {
  act(() => useDocumentStore.getState().select("r1"));
}

describe("arrastrar el elemento seleccionado", () => {
  it("durante el arrastre se mueven la copia y el contorno, sin mandar nada al núcleo", () => {
    select();
    const before = translate(layer());
    press(layer()!, 400, 300);
    moveTo(450, 320);
    moveTo(480, 330);

    expect(ops).toHaveLength(0);
    const after = translate(layer());
    expect(after.x - before.x).toBeCloseTo(80, 6);
    expect(after.y - before.y).toBeCloseTo(30, 6);
    expect(ghost()).not.toBeNull();
    expect(ghost()!.getAttribute("src")).toBe("blob:<svg>pagina</svg>");
  });

  it("al soltar manda un solo movimiento, justo el que se veía, y la copia se queda hasta que llega lo compilado", async () => {
    select();
    press(layer()!, 400, 300);
    moveTo(437, 289);
    const shownOffset = translate(ghost());
    await release(437, 289);

    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.op).toBe("move");
    expect(op.id).toBe("r1");
    // Redondeado al micrómetro para el documento…
    expect(op.dx).toBe(Math.round((37 / PX_PER_MM) * 1000) / 1000);
    expect(op.dy).toBe(Math.round((-11 / PX_PER_MM) * 1000) / 1000);

    // …y lo que se veía, a menos de una centésima de píxel.
    const sheet = translate(container.querySelector(".canvas-page"));
    expect(Math.abs(shownOffset.x - sheet.x - (op.dx as number) * PX_PER_MM)).toBeLessThan(0.01);

    // Hasta que llegan las cajas de la revisión nueva, la copia sigue ahí.
    expect(ghost()).not.toBeNull();
    act(() => useLayoutStore.getState().update(2, [{ ...r1, x: 30 + (op.dx as number) }]));
    expect(ghost()).toBeNull();
  });

  it("si la compilación nueva falla, la copia también se va", async () => {
    select();
    press(layer()!, 400, 300);
    moveTo(450, 300);
    await release(450, 300);
    expect(ghost()).not.toBeNull();
    act(() =>
      useCompilationStore.getState().fail({
        revision: 2,
        ms: 1,
        reused: false,
        diagnostics: [],
        error: { kind: "invalid", message: "no" },
      }),
    );
    expect(ghost()).toBeNull();
  });

  it("Esc durante el arrastre lo cancela: no se manda nada y todo vuelve a su sitio", async () => {
    select();
    const before = translate(layer());
    press(layer()!, 400, 300);
    moveTo(500, 350);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    await release(500, 350);

    expect(ops).toHaveLength(0);
    expect(ghost()).toBeNull();
    expect(translate(layer())).toEqual(before);
    // Y sigue seleccionado: Escape era para el arrastre.
    expect(useDocumentStore.getState().selectedElement).toBe("r1");
  });

  it("Shift restringe el movimiento a un eje", async () => {
    select();
    press(layer()!, 400, 300);
    moveTo(460, 320, { shiftKey: true });
    await release(460, 320);
    expect(ops[0]).toMatchObject({ dx: Math.round((60 / PX_PER_MM) * 1000) / 1000, dy: 0 });
  });

  it("pulsar y soltar sin mover no es un cambio", async () => {
    select();
    press(layer()!, 400, 300);
    await release(400, 300);
    expect(ops).toHaveLength(0);
    expect(ghost()).toBeNull();
  });

  it("pulsar un elemento sin seleccionar y arrastrar lo selecciona y lo mueve", async () => {
    hit = "r1";
    const viewport = container.querySelector<HTMLElement>(".canvas-viewport")!;
    press(viewport, 400, 300);
    await settle();
    expect(useDocumentStore.getState().selectedElement).toBe("r1");
    moveTo(420, 300);
    await release(420, 300);
    expect(ops).toEqual([{ op: "move", id: "r1", dx: Math.round((20 / PX_PER_MM) * 1000) / 1000, dy: 0 }]);
  });
});

describe("flechas", () => {
  it("mueven 1 mm, y 10 mm con Shift", async () => {
    select();
    const key = async (init: KeyboardEventInit) => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
      });
      await settle();
    };
    await key({ key: "ArrowRight" });
    await key({ key: "ArrowUp", shiftKey: true });
    expect(ops).toEqual([
      { op: "move", id: "r1", dx: 1, dy: 0 },
      { op: "move", id: "r1", dx: 0, dy: -10 },
    ]);
  });

  it("sin nada seleccionado no hacen nada", async () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
    });
    await settle();
    expect(ops).toHaveLength(0);
  });
});
