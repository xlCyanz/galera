import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { PX_PER_MM } from "./geometry";
import { FIT_MARGIN } from "./zoom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => new Promise(() => undefined),
};

const a4: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "A4" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] }],
  },
};

// jsdom no maqueta: el área mide 800 × 600 px y empieza en (40, 20) de la
// pantalla.
const AREA = { left: 40, top: 20, width: 800, height: 600 };

let container: HTMLDivElement;
let root: Root;
const restore: Array<() => void> = [];

function fakeViewportLayout() {
  const proto = HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("canvas-viewport")
      ? new DOMRect(AREA.left, AREA.top, AREA.width, AREA.height)
      : original.call(this);
  };
  const width = Object.getOwnPropertyDescriptor(proto, "clientWidth");
  const height = Object.getOwnPropertyDescriptor(proto, "clientHeight");
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => AREA.width });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => AREA.height });
  restore.push(() => {
    proto.getBoundingClientRect = original;
    if (width) Object.defineProperty(proto, "clientWidth", width);
    if (height) Object.defineProperty(proto, "clientHeight", height);
  });
}

const zoom = () => useDocumentStore.getState().zoom;
const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const sheet = () => container.querySelector<HTMLElement>(".canvas-page")!;

/** Dónde está la hoja en la pantalla, leyendo su `translate`. */
function sheetOnScreen() {
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(sheet().style.transform);
  return {
    left: AREA.left + Number(match?.[1]),
    top: AREA.top + Number(match?.[2]),
    width: parseFloat(sheet().style.width),
    height: parseFloat(sheet().style.height),
  };
}

/** El punto de la página, en mm, que está bajo un punto de la pantalla. */
function mmUnder(clientX: number, clientY: number) {
  const { left, top } = sheetOnScreen();
  const scale = PX_PER_MM * zoom();
  return { x: (clientX - left) / scale, y: (clientY - top) / scale };
}

beforeEach(() => {
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(a4);
  fakeViewportLayout();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Canvas loader={loader} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  while (restore.length > 0) restore.pop()?.();
});

function button(name: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label^="${name}"]`)!;
}

function key(type: "keydown" | "keyup", init: KeyboardEventInit) {
  const event = new KeyboardEvent(type, { cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function wheel(init: WheelEventInit) {
  const event = new WheelEvent("wheel", { cancelable: true, ...init });
  act(() => {
    viewport().dispatchEvent(event);
  });
  return event;
}

describe("posición de la página", () => {
  it("sin desplazar, la página queda centrada en el área", () => {
    const { left, top, width, height } = sheetOnScreen();
    expect(left - AREA.left).toBeCloseTo((AREA.width - width) / 2, 6);
    expect(top - AREA.top).toBeCloseTo((AREA.height - height) / 2, 6);
  });
});

describe("controles de zoom", () => {
  it("enseñan el nivel de zoom", () => {
    expect(container.querySelector(".canvas-zoom-level")?.textContent).toBe("100 %");
    act(() => useDocumentStore.getState().setZoom(2.5));
    expect(container.querySelector(".canvas-zoom-level")?.textContent).toBe("250 %");
  });

  it("acercar, alejar y volver al 100 %", () => {
    act(() => button("Acercar").click());
    expect(zoom()).toBe(1.25);
    act(() => button("Acercar").click());
    expect(zoom()).toBe(1.5);
    act(() => button("Alejar").click());
    expect(zoom()).toBe(1.25);
    act(() => button("Zoom").click());
    expect(zoom()).toBe(1);
  });

  it("ajustar a la ventana deja la página entera, centrada y con margen", () => {
    act(() => useDocumentStore.getState().setView(3, { x: 250, y: -400 }));
    act(() => button("Ajustar").click());

    const { top, height } = sheetOnScreen();
    expect(height).toBeCloseTo(AREA.height - 2 * FIT_MARGIN, 6);
    expect(top - AREA.top).toBeCloseTo(FIT_MARGIN, 6);
    expect(useDocumentStore.getState().scroll).toEqual({ x: 0, y: 0 });
  });
});

describe("atajos", () => {
  // En jsdom `navigator.userAgent` no es de Mac: los atajos van con Ctrl.
  it("Ctrl+ acerca, Ctrl- aleja, Ctrl0 es 100 % y Ctrl1 ajusta", () => {
    expect(key("keydown", { key: "=", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(zoom()).toBe(1.25);
    key("keydown", { key: "-", ctrlKey: true });
    expect(zoom()).toBe(1);
    key("keydown", { key: "+", ctrlKey: true, shiftKey: true });
    key("keydown", { key: "0", ctrlKey: true });
    expect(zoom()).toBe(1);
    key("keydown", { key: "1", ctrlKey: true });
    expect(sheetOnScreen().height).toBeCloseTo(AREA.height - 2 * FIT_MARGIN, 6);
  });

  it("acercar con atajo mantiene el centro del área", () => {
    const center = { x: AREA.left + AREA.width / 2, y: AREA.top + AREA.height / 2 };
    act(() => useDocumentStore.getState().setView(1, { x: 120, y: -80 }));
    const before = mmUnder(center.x, center.y);
    key("keydown", { key: "=", ctrlKey: true });
    const after = mmUnder(center.x, center.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("sin documento abierto no hacen nada", () => {
    act(() => useDocumentStore.getState().close());
    expect(key("keydown", { key: "=", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(zoom()).toBe(1);
  });
});

describe("zoom hacia el puntero", () => {
  it("con Ctrl + rueda, el punto bajo el puntero se queda bajo el puntero", () => {
    const pointer = { clientX: 300, clientY: 150 };
    const before = mmUnder(pointer.clientX, pointer.clientY);

    for (let step = 0; step < 10; step++) {
      expect(wheel({ deltaY: -10, ctrlKey: true, ...pointer }).defaultPrevented).toBe(true);
    }

    expect(zoom()).toBeCloseTo(Math.E, 6);
    expect(sheetOnScreen().width).toBeCloseTo(210 * PX_PER_MM * zoom(), 6);
    const after = mmUnder(pointer.clientX, pointer.clientY);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("la pinza de WebKit hace zoom hacia los dedos, relativo al inicio del gesto", () => {
    const fingers = { clientX: 520, clientY: 480 };
    const before = mmUnder(fingers.clientX, fingers.clientY);
    const gesture = (type: string, scale: number) => {
      const event = Object.assign(new UIEvent(type, { cancelable: true }), { scale, ...fingers });
      act(() => {
        viewport().dispatchEvent(event);
      });
      return event;
    };

    expect(gesture("gesturestart", 1).defaultPrevented).toBe(true);
    gesture("gesturechange", 1.5);
    expect(zoom()).toBeCloseTo(1.5, 9);
    gesture("gesturechange", 2);
    expect(zoom()).toBeCloseTo(2, 9);

    // Durante la pinza, la rueda con Ctrl que algunos webview mandan a la vez
    // no suma otro zoom.
    wheel({ deltaY: -100, ctrlKey: true, ...fingers });
    expect(zoom()).toBeCloseTo(2, 9);
    gesture("gestureend", 2);

    const after = mmUnder(fingers.clientX, fingers.clientY);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe("desplazar", () => {
  it("la rueda o dos dedos desplazan la página al revés del gesto", () => {
    const start = sheetOnScreen();
    expect(wheel({ deltaX: 15, deltaY: 40 }).defaultPrevented).toBe(true);
    const moved = sheetOnScreen();
    expect(moved.left - start.left).toBeCloseTo(-15, 9);
    expect(moved.top - start.top).toBeCloseTo(-40, 9);
    expect(zoom()).toBe(1);
  });

  it("con Shift, la rueda vertical desplaza en horizontal", () => {
    const start = sheetOnScreen();
    wheel({ deltaY: 30, shiftKey: true });
    expect(sheetOnScreen().left - start.left).toBeCloseTo(-30, 9);
    expect(sheetOnScreen().top).toBeCloseTo(start.top, 9);
  });

  function pointer(type: string, init: MouseEventInit) {
    // jsdom no tiene PointerEvent: un MouseEvent con `pointerId` basta.
    const event = Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }), {
      pointerId: 1,
    });
    act(() => {
      viewport().dispatchEvent(event);
    });
  }

  it("con Espacio pulsado, arrastrar mueve la página con el puntero", () => {
    viewport().setPointerCapture = () => undefined;
    expect(key("keydown", { code: "Space", key: " " }).defaultPrevented).toBe(true);
    expect(viewport().classList.contains("is-pan-ready")).toBe(true);

    const start = sheetOnScreen();
    pointer("pointerdown", { button: 0, clientX: 400, clientY: 300 });
    expect(viewport().classList.contains("is-panning")).toBe(true);
    pointer("pointermove", { clientX: 370, clientY: 260 });
    pointer("pointermove", { clientX: 360, clientY: 250 });
    const moved = sheetOnScreen();
    expect(moved.left - start.left).toBeCloseTo(-40, 9);
    expect(moved.top - start.top).toBeCloseTo(-50, 9);

    pointer("pointerup", {});
    expect(viewport().classList.contains("is-panning")).toBe(false);
    key("keyup", { code: "Space", key: " " });
    expect(viewport().classList.contains("is-pan-ready")).toBe(false);
  });

  it("sin Espacio, arrastrar con el botón izquierdo no desplaza", () => {
    viewport().setPointerCapture = () => undefined;
    const start = sheetOnScreen();
    pointer("pointerdown", { button: 0, clientX: 400, clientY: 300 });
    pointer("pointermove", { clientX: 300, clientY: 300 });
    expect(sheetOnScreen().left).toBe(start.left);
  });

  it("la página nunca se pierde de vista entera", () => {
    for (let step = 0; step < 50; step++) {
      wheel({ deltaY: 500 });
    }
    const { top, height } = sheetOnScreen();
    expect(top + height).toBeGreaterThan(AREA.top);
  });
});
