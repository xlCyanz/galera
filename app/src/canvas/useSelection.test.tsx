import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { PX_PER_MM } from "./geometry";
import { HIT_TOLERANCE_PX, wantsToGoThrough } from "./useSelection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => new Promise(() => undefined),
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
    pages: [{ id: "p1", size: { width: 200, height: 100, unit: "mm" }, elements: [] }],
  },
};

// jsdom no maqueta: el área mide 1000 × 600 px y empieza en (40, 30).
const AREA = { left: 40, top: 30, width: 1000, height: 600 };

let container: HTMLDivElement;
let root: Root;
let calls: Array<Record<string, unknown>>;
let answer: (args: Record<string, unknown>) => Promise<string | null> | string | null;
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

  calls = [];
  answer = () => null;
  mockIPC((command, args) => {
    if (command === "element_at") {
      calls.push(args as Record<string, unknown>);
      return answer(args as Record<string, unknown>);
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
  while (restore.length > 0) restore.pop()?.();
});

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const selected = () => useDocumentStore.getState().selectedElement;

/**
 * Un clic en un punto de la pantalla —pulsar y soltar enseguida—, y espera
 * la respuesta del núcleo.
 */
async function click(clientX: number, clientY: number, init: MouseEventInit = {}) {
  await act(async () => {
    viewport().dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX, clientY, ...init }),
    );
    window.dispatchEvent(new MouseEvent("pointerup", { clientX, clientY }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** El punto de la pantalla donde cae un punto de la página, en mm. */
function screenPoint(x: number, y: number) {
  // La página de 200 × 100 mm, al 100 %, centrada en el área.
  const left = AREA.left + (AREA.width - 200 * PX_PER_MM) / 2;
  const top = AREA.top + (AREA.height - 100 * PX_PER_MM) / 2;
  return { clientX: left + x * PX_PER_MM, clientY: top + y * PX_PER_MM };
}

describe("seleccionar con un clic", () => {
  it("pregunta al núcleo con el punto en mm de la página y selecciona lo que dice", async () => {
    answer = () => "r1";
    const { clientX, clientY } = screenPoint(50, 25);
    await click(clientX, clientY);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.page).toBe(0);
    expect(call.x as number).toBeCloseTo(50, 9);
    expect(call.y as number).toBeCloseTo(25, 9);
    expect(call.tolerance as number).toBeCloseTo(HIT_TOLERANCE_PX / PX_PER_MM, 12);
    expect(call.below).toBeNull();
    expect(selected()).toBe("r1");
  });

  it("la tolerancia son siempre los mismos píxeles, a cualquier zoom", async () => {
    act(() => useDocumentStore.getState().setZoom(4));
    await click(500, 300);
    expect(calls[0]!.tolerance as number).toBeCloseTo(HIT_TOLERANCE_PX / (PX_PER_MM * 4), 12);
  });

  it("un clic en una zona vacía deselecciona", async () => {
    act(() => useDocumentStore.getState().select("r1"));
    answer = () => null;
    await click(45, 35);
    expect(selected()).toBeNull();
  });

  it("Alt o ⌘ + clic pide atravesar desde lo seleccionado", async () => {
    act(() => useDocumentStore.getState().select("arriba"));
    answer = () => "abajo";
    await click(500, 300, { altKey: true });
    expect(calls[0]!.below).toBe("arriba");
    expect(selected()).toBe("abajo");

    await click(500, 300, { metaKey: true });
    expect(calls[1]!.below).toBe("abajo");
  });

  it("con Espacio pulsado, arrastrar desplaza y no selecciona", async () => {
    viewport().setPointerCapture = () => undefined;
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", cancelable: true }));
    });
    await click(500, 300);
    expect(calls).toHaveLength(0);
  });

  it("solo con el botón principal", async () => {
    await click(500, 300, { button: 2 });
    expect(calls).toHaveLength(0);
  });

  it("si llega tarde la respuesta de un clic anterior, gana el último clic", async () => {
    let releaseFirst: (id: string) => void = () => undefined;
    answer = () => new Promise<string>((resolve) => (releaseFirst = resolve));
    await click(500, 300);
    answer = () => "segundo";
    await click(600, 300);
    expect(selected()).toBe("segundo");

    await act(async () => {
      releaseFirst("primero");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(selected()).toBe("segundo");
  });

  it("el seleccionado se contornea con su caja real, y Escape lo deselecciona", async () => {
    act(() =>
      useLayoutStore.getState().update(1, [
        {
          id: "r1",
          page: 0,
          x: 10,
          y: 20,
          w: 30,
          h: 15,
          rotation: 0,
          bounds: { x: 10, y: 20, w: 30, h: 15 },
          line: null,
        },
      ]),
    );
    answer = () => "r1";
    await click(500, 300);

    const outline = container.querySelector<HTMLElement>(".control-layer");
    expect(outline).not.toBeNull();
    expect(parseFloat(outline!.style.width)).toBeCloseTo(30 * PX_PER_MM, 6);
    expect(parseFloat(outline!.style.height)).toBeCloseTo(15 * PX_PER_MM, 6);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(selected()).toBeNull();
    expect(container.querySelector(".control-layer")).toBeNull();
  });
});

describe("wantsToGoThrough", () => {
  it("con Alt o con ⌘", () => {
    expect(wantsToGoThrough({ altKey: true, metaKey: false })).toBe(true);
    expect(wantsToGoThrough({ altKey: false, metaKey: true })).toBe(true);
    expect(wantsToGoThrough({ altKey: false, metaKey: false })).toBe(false);
  });
});
