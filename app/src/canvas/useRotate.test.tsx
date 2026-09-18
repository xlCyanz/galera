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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const box = (id: string, x: number, y: number, w: number, h: number, rotation = 0): LayoutBox => ({
  id, page: 0, x, y, w, h, rotation, bounds: { x, y, w, h }, line: null,
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
      const applied: AppliedOp = { revision: 1 + ops.length, document: structuredClone(project.document), description: "" };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  const boxes = [box("r1", 30, 40, 60, 20), box("t1", 100, 10, 50, 7.5, 30)];
  useCompilationStore.getState().finish({ revision: 1, ms: 1, reused: false, diagnostics: [], pages: ["<svg/>"], boxes });
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
const label = () => container.querySelector(".angle-label")?.textContent ?? null;
/** El giro con el que se dibuja el contorno, en grados. */
const drawn = () => parseFloat(/rotate\((-?[\d.e-]+)deg\)/.exec(layer().style.transform)![1]!);

/** El centro del contorno en la pantalla (el área está en el origen en jsdom). */
function center() {
  const [, left, top] = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\)/.exec(layer().style.transform)!;
  return {
    x: parseFloat(left!) + parseFloat(layer().style.width) / 2,
    y: parseFloat(top!) + parseFloat(layer().style.height) / 2,
  };
}

/** Pulsa el manejador de rotación, a `R` píxeles del centro y en la dirección `angle`. */
const R = 100;
function at(angle: number) {
  const c = center();
  const radians = (angle * Math.PI) / 180;
  return { clientX: c.x + R * Math.sin(radians), clientY: c.y - R * Math.cos(radians) };
}

let pivot = { x: 0, y: 0 };

function grab(angle: number) {
  pivot = center();
  const point = at(angle);
  act(() => {
    container
      .querySelector<HTMLElement>('[data-handle="rotate"]')!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...point }));
  });
}

/** Lleva el puntero a la dirección `angle` vista desde el centro que había al pulsar. */
function turn(angle: number, init: MouseEventInit = {}) {
  const radians = (angle * Math.PI) / 180;
  act(() => {
    window.dispatchEvent(
      new MouseEvent("pointermove", {
        clientX: pivot.x + R * Math.sin(radians),
        clientY: pivot.y - R * Math.cos(radians),
        ...init,
      }),
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

describe("girar con el manejador de rotación", () => {
  it("se ve en vivo, con el ángulo, sin mandar nada al núcleo", () => {
    select("r1");
    expect(label()).toBeNull();
    grab(0);
    turn(37.5);
    expect(ops).toHaveLength(0);
    expect(drawn()).toBeCloseTo(37.5, 6);
    expect(label()).toBe("37,5°");
    // Gira sobre su centro: la caja sin girar no se mueve.
    expect(center().x).toBeCloseTo(pivot.x, 6);
    expect(center().y).toBeCloseTo(pivot.y, 6);
  });

  it("al soltar manda un único Rotate, y la vista previa espera a lo compilado", async () => {
    select("r1");
    grab(0);
    turn(45);
    turn(100);
    await release();

    expect(ops).toEqual([{ op: "rotate", id: "r1", rotation: 100 }]);
    expect(label()).toBeNull();
    // Hasta que llegan las cajas nuevas, el contorno sigue girado.
    expect(drawn()).toBeCloseTo(100, 6);
    act(() => useLayoutStore.getState().update(2, [box("r1", 30, 40, 60, 20, 100)]));
    expect(drawn()).toBeCloseTo(100, 6);
  });

  it("parte del giro que ya tiene y no salta al pulsar lejos del centro del manejador", async () => {
    select("t1");
    grab(10);
    turn(10);
    expect(drawn()).toBeCloseTo(30, 6);
    turn(-20);
    await release();
    expect(ops).toEqual([{ op: "rotate", id: "t1", rotation: 0 }]);
  });

  it("pasar de media vuelta da el ángulo entre -180 y 180", async () => {
    select("r1");
    grab(0);
    turn(200);
    await release();
    expect(ops[0]!.rotation as number).toBeCloseTo(-160, 9);
  });

  it("Shift fija incrementos de 15°", async () => {
    select("r1");
    grab(0);
    turn(38, { shiftKey: true });
    expect(drawn()).toBe(45);
    expect(label()).toBe("45°");
    turn(38);
    expect(drawn()).toBeCloseTo(38, 6);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }));
    });
    expect(drawn()).toBe(45);
    await release();
    expect(ops).toEqual([{ op: "rotate", id: "r1", rotation: 45 }]);
  });

  it("Esc cancela y el elemento vuelve a su giro", async () => {
    select("r1");
    grab(0);
    turn(90);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    await release();
    expect(ops).toHaveLength(0);
    expect(drawn()).toBe(0);
    expect(useDocumentStore.getState().selectedElement).toBe("r1");
  });

  it("pulsar el manejador y soltar sin girar no es un cambio, ni deselecciona", async () => {
    select("r1");
    grab(0);
    await release();
    expect(ops).toHaveLength(0);
    expect(useDocumentStore.getState().selectedElement).toBe("r1");
  });
});
