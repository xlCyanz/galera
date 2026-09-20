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
    pages: [
      {
        id: "p1",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [
          {
            type: "text",
            id: "t1",
            x: 10,
            y: 10,
            w: 80,
            h: null,
            rotation: 0,
            content: [{ text: "Hola mundo", bold: false, italic: false, underline: false }],
            style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
          },
          {
            type: "rect",
            id: "r1",
            x: 120,
            y: 10,
            w: 40,
            h: 20,
            rotation: 0,
            fill: "#000000",
            stroke: null,
            radius: 0,
          },
        ],
      },
    ],
  },
};

const boxes: LayoutBox[] = [
  { id: "t1", page: 0, x: 10, y: 10, w: 25, h: 11, rotation: 0, bounds: { x: 10, y: 10, w: 25, h: 11 }, line: null },
  { id: "r1", page: 0, x: 120, y: 10, w: 40, h: 20, rotation: 0, bounds: { x: 120, y: 10, w: 40, h: 20 }, line: null },
];

// jsdom no maqueta: el área mide 1000 × 600 px y empieza en (40, 30).
const AREA = { left: 40, top: 30, width: 1000, height: 600 };

let container: HTMLDivElement;
let root: Root;
/** Qué contesta el núcleo a `element_at`. */
let found: string | null;
/** Los glifos del texto «Hola mundo», dos líneas de cinco milímetros. */
const scene: Glyph[] = [0, 1, 2, 3, 6, 7, 8, 9, 10].map((text_index) => {
  const line = text_index < 6 ? 0 : 1;
  const column = line === 0 ? text_index : text_index - 6;
  return {
    text_index,
    line,
    x: 10 + column * 5,
    y: 10 + line * 6,
    width: 5,
    line_height: 5,
    baseline: 14 + line * 6,
  };
});
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
  mockIPC((command) => {
    if (command === "element_at") {
      return found;
    }
    return command === "glyphs" ? scene : null;
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

describe("entrar a escribir en un texto", () => {
  it("doble clic sobre un texto lo selecciona y abre el campo con el foco", async () => {
    found = "t1";
    await doubleClick(20, 12);

    expect(useEditingStore.getState().element).toBe("t1");
    expect(useDocumentStore.getState().selectedElement).toBe("t1");
    expect(input()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    // El cursor entra al final del texto.
    expect(useEditingStore.getState().start).toBe(10);
  });

  it("doble clic sobre lo que no es un texto no abre nada", async () => {
    found = "r1";
    await doubleClick(130, 15);
    expect(useEditingStore.getState().element).toBeNull();
    expect(input()).toBeNull();
  });

  it("pulsar en el lienzo deja de escribir", async () => {
    found = "t1";
    await doubleClick(20, 12);
    expect(input()).not.toBeNull();

    found = null;
    await press(150, 80);
    expect(useEditingStore.getState().element).toBeNull();
    expect(input()).toBeNull();
  });

  it("cambiar de herramienta deja de escribir", async () => {
    found = "t1";
    await doubleClick(20, 12);
    await act(async () => {
      useToolStore.getState().setTool("rect");
    });
    expect(useEditingStore.getState().element).toBeNull();
    expect(input()).toBeNull();
  });
});

describe("señalar dentro del texto que se escribe", () => {
  /** Entra a escribir en «t1», con sus glifos ya pedidos. */
  async function enter() {
    found = "t1";
    await doubleClick(50, 50);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(useEditingStore.getState().glyphs).toHaveLength(9);
  }

  /** Pulsa dentro del texto, con los clics seguidos que se digan. */
  async function press(x: number, y: number, init: MouseEventInit = {}) {
    const { clientX, clientY } = screenPoint(x, y);
    await act(async () => {
      viewport().dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          detail: 1,
          clientX,
          clientY,
          ...init,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function dragTo(x: number, y: number) {
    const { clientX, clientY } = screenPoint(x, y);
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX, clientY }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const selection = () => {
    const { start, end } = useEditingStore.getState();
    return [start, end];
  };

  it("pulsar pone el cursor donde se pulsó, sin dejar de escribir", async () => {
    await enter();
    await press(21, 12);
    expect(useEditingStore.getState().element).toBe("t1");
    expect(selection()).toEqual([2, 2]);
    // Y el campo invisible va con ello: escribir sustituiría ahí.
    expect(input()?.selectionStart).toBe(2);
  });

  it("arrastrar selecciona un tramo", async () => {
    await enter();
    await press(11, 12);
    await dragTo(24, 12);
    expect(selection()).toEqual([0, 3]);
    expect([input()?.selectionStart, input()?.selectionEnd]).toEqual([0, 3]);
  });

  it("arrastrar hasta la línea de abajo selecciona lo de en medio", async () => {
    await enter();
    await press(11, 12);
    await dragTo(19, 18);
    expect(selection()).toEqual([0, 8]);
  });

  it("doble clic coge la palabra y triple clic el párrafo", async () => {
    await enter();
    await press(21, 12, { detail: 2 });
    expect(selection()).toEqual([0, 4]);

    await press(21, 12, { detail: 3 });
    expect(selection()).toEqual([0, 10]);
  });

  it("⇧ + clic estira lo que ya había", async () => {
    await enter();
    await press(11, 12);
    await press(24, 12, { shiftKey: true });
    expect(selection()).toEqual([0, 3]);
  });

  it("pulsar fuera del texto deja de escribir", async () => {
    await enter();
    found = null;
    await press(150, 80);
    expect(useEditingStore.getState().element).toBeNull();
  });
});
