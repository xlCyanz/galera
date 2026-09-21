import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Canvas } from "../canvas/Canvas";
import type { ImageLoader } from "../canvas/PageSvg";
import { PX_PER_MM } from "../canvas/geometry";
import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import { useLayoutStore } from "../store/layout";
import { useToolStore } from "../store/tool";
import type { Glyph, LayoutBox } from "../types/layout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => new Promise(() => undefined),
};

/** El texto del flujo: dos palabras por zona, tres zonas. */
const TEXT = "uno dos tres cuatro cinco seis";

const zone = (id: string, x: number) => ({
  type: "flow" as const,
  id,
  x,
  y: 10,
  w: 40,
  h: 20,
  rotation: 0,
  flow: "cuerpo",
});

const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: ["fonts/Inter-Regular.ttf"],
    assets: {},
    variables: {},
    flows: {
      cuerpo: {
        content: [{ text: TEXT, bold: false, italic: false, underline: false }],
        style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
        zones: ["z1", "z2", "z3"],
      },
    },
    pages: [
      {
        id: "p1",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [zone("z1", 10), zone("z2", 60)],
      },
      {
        id: "p2",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [zone("z3", 10)],
      },
    ],
  },
};

const box = (id: string, page: number, x: number): LayoutBox => ({
  id,
  page,
  x,
  y: 10,
  w: 40,
  h: 20,
  rotation: 0,
  bounds: { x, y: 10, w: 40, h: 20 },
  line: null,
  overflow: 0,
});

const boxes: LayoutBox[] = [box("z1", 0, 10), box("z2", 0, 60), box("z3", 1, 10)];

/**
 * Los glifos del flujo: «uno dos» en la primera zona, «tres cuatro» en la
 * segunda —las dos en la página 0— y el resto en la zona de la página 1.
 * Las líneas siguen contando de una zona a la siguiente, como las devuelve
 * el núcleo.
 */
const scene: Glyph[] = [...TEXT].flatMap((_, text_index) => {
  const zone = text_index < 8 ? 0 : text_index < 20 ? 1 : 2;
  const column = text_index - (zone === 0 ? 0 : zone === 1 ? 8 : 20);
  return [
    {
      page: zone === 2 ? 1 : 0,
      text_index,
      line: zone,
      x: (zone === 1 ? 60 : 10) + column * 3,
      y: 10,
      width: 3,
      line_height: 5,
      baseline: 14,
    },
  ];
});

// jsdom no maqueta: el área mide 1000 × 600 px y empieza en (40, 30).
const AREA = { left: 40, top: 30, width: 1000, height: 600 };

let container: HTMLDivElement;
let root: Root;
/** Qué contesta el núcleo a `element_at`. */
let found: string | null;
/** Lo que se le ha pedido al backend. */
let asked: Array<{ command: string; args: Record<string, unknown> }>;
const restore: Array<() => void> = [];

beforeEach(() => {
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

  found = null;
  asked = [];
  mockIPC((command, args) => {
    asked.push({ command, args: args as Record<string, unknown> });
    if (command === "element_at") {
      return found;
    }
    if (command === "flow_glyphs") {
      return scene;
    }
    if (command === "apply_op") {
      return {
        revision: 2,
        document: project.document,
        description: "Escribir",
        undo: null,
        redo: null,
      };
    }
    return command === "glyphs" ? [] : null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useEditingStore.setState(useEditingStore.getInitialState(), true);
  useToolStore.setState(useToolStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useLayoutStore.getState().update(1, boxes);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Canvas loader={loader} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  while (restore.length > 0) restore.pop()?.();
});

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const input = () => container.querySelector("textarea");
const zones = () => [...container.querySelectorAll<HTMLElement>("[data-zone]")];

/** El punto de la pantalla donde cae un punto de la página, en mm. */
function screenPoint(x: number, y: number) {
  const left = AREA.left + (AREA.width - 200 * PX_PER_MM) / 2;
  const top = AREA.top + (AREA.height - 100 * PX_PER_MM) / 2;
  return { clientX: left + x * PX_PER_MM, clientY: top + y * PX_PER_MM };
}

async function doubleClick(x: number, y: number) {
  const { clientX, clientY } = screenPoint(x, y);
  await act(async () => {
    viewport().dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0, clientX, clientY }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function press(x: number, y: number) {
  const { clientX, clientY } = screenPoint(x, y);
  await act(async () => {
    viewport().dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX, clientY }),
    );
    window.dispatchEvent(new MouseEvent("pointerup", { clientX, clientY }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Entra a escribir el flujo por su primera zona. */
async function enter() {
  found = "z1";
  await doubleClick(20, 15);
}

describe("escribir en un texto que fluye", () => {
  it("doble clic en una zona escribe su flujo, no la zona", async () => {
    await enter();

    const state = useEditingStore.getState();
    expect(state.flow).toBe("cuerpo");
    expect(state.element).toBeNull();
    expect(input()).not.toBeNull();
    // El cursor entra al final del texto del flujo entero.
    expect(state.start).toBe(TEXT.length);
  });

  /** El criterio de la tarea: el cursor cruza de una zona a la siguiente. */
  it("pulsar en otra zona lleva el cursor a esa parte del mismo texto", async () => {
    await enter();
    // La segunda zona empieza en «tres», el noveno carácter.
    await press(61, 15);

    const { start, end, flow } = useEditingStore.getState();
    expect(flow).toBe("cuerpo");
    expect(start).toBe(8);
    expect(end).toBe(8);
  });

  /** El criterio de la tarea: la selección abarca varias zonas. */
  it("arrastrar de una zona a otra selecciona el texto de en medio", async () => {
    await enter();
    const from = screenPoint(11, 15);
    const to = screenPoint(70, 15);

    await act(async () => {
      viewport().dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: from.clientX,
          clientY: from.clientY,
        }),
      );
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: to.clientX, clientY: to.clientY }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: to.clientX, clientY: to.clientY }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const { start, end } = useEditingStore.getState();
    expect(start).toBe(0);
    // Hasta donde se soltó, ya en la segunda zona.
    expect(end).toBeGreaterThan(8);
  });

  it("escribir manda un comando del flujo, no de la zona", async () => {
    await enter();
    const field = input()!;

    await act(async () => {
      field.value = `${TEXT}!`;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const op = asked.find((one) => one.command === "apply_op")?.args.op as
      | Record<string, unknown>
      | undefined;
    expect(op?.op).toBe("insert_flow_text");
    expect(op?.flow).toBe("cuerpo");
    expect(op?.text).toBe("!");
  });

  it("pide los glifos del flujo entero", async () => {
    await enter();
    expect(asked.some((one) => one.command === "flow_glyphs")).toBe(true);
  });

  /** El criterio de la tarea: las zonas enlazadas se ven en el lienzo. */
  it("marca las zonas de la cadena con el sitio que ocupan", async () => {
    await enter();

    const marked = zones();
    // Las dos de esta página; la tercera está en la siguiente.
    expect(marked.map((one) => one.dataset.zone)).toEqual(["z1", "z2"]);
    expect(marked[0]?.textContent).toBe("1 de 3");
    expect(marked[1]?.textContent).toBe("2 de 3");
  });

  it("el cursor solo se dibuja en la página donde cayó", async () => {
    await enter();
    // El cursor está al final del texto, que se compone en la página 1.
    expect(container.querySelector(".text-cursor")).toBeNull();

    act(() => useEditingStore.getState().select(0, 0));
    expect(container.querySelector(".text-cursor")).not.toBeNull();
  });
});
