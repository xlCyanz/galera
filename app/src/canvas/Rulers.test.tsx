import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { PX_PER_MM } from "./geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => new Promise(() => undefined),
};

const a4: OpenedProject = {
  root: "/p",
  document: {
    version: 1,
    meta: { title: "A4" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] }],
  },
};

// jsdom no maqueta: el área mide 900 × 700 px y empieza en (50, 30).
const AREA = { left: 50, top: 30, width: 900, height: 700 };

let container: HTMLDivElement;
let root: Root;
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

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(a4);
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

const ruler = (orientation: "horizontal" | "vertical") =>
  container.querySelector<SVGSVGElement>(`.ruler-${orientation}`);

/** Dónde está la hoja dentro del área, leyendo su `translate`. */
function sheetOrigin() {
  const style = container.querySelector<HTMLElement>(".canvas-page")!.style.transform;
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(style);
  return { x: Number(match?.[1]), y: Number(match?.[2]) };
}

describe("reglas", () => {
  it("se ven al abrir un documento, una horizontal y una vertical", () => {
    expect(ruler("horizontal")).not.toBeNull();
    expect(ruler("vertical")).not.toBeNull();
    expect(ruler("horizontal")?.getAttribute("width")).toBe(String(AREA.width));
    expect(ruler("vertical")?.getAttribute("height")).toBe(String(AREA.height));
  });

  it("el 0 de cada regla cae en la esquina superior izquierda de la página", () => {
    // Con la esquina de la página dentro del área, para que el 0 se vea.
    act(() => useDocumentStore.getState().setView(0.8, { x: -130, y: 150 }));
    const origin = sheetOrigin();

    const zeroX = ruler("horizontal")?.querySelector<SVGLineElement>('line[data-mm="0"]');
    const zeroY = ruler("vertical")?.querySelector<SVGLineElement>('line[data-mm="0"]');
    expect(Number(zeroX?.getAttribute("x1"))).toBe(Math.round(origin.x) + 0.5);
    expect(Number(zeroY?.getAttribute("y1"))).toBe(Math.round(origin.y) + 0.5);
  });

  it("los milímetros siguen la escala del zoom, con marcas mayores y menores", () => {
    // Al 200 % la A4 es más ancha que el área: se mueve para ver su borde.
    act(() => useDocumentStore.getState().setView(2, { x: 400, y: 0 }));
    const origin = sheetOrigin();
    const line = (mm: number) =>
      ruler("horizontal")?.querySelector<SVGLineElement>(`line[data-mm="${mm}"]`);

    expect(line(10)?.getAttribute("class")).toBe("ruler-tick-major");
    expect(line(1)?.getAttribute("class")).toBe("ruler-tick-minor");
    expect(Number(line(10)?.getAttribute("x1"))).toBe(Math.round(origin.x + 10 * PX_PER_MM * 2) + 0.5);
    expect([...(ruler("horizontal")?.querySelectorAll("text") ?? [])].map((t) => t.textContent)).toContain("10");
  });

  it("la posición del puntero se marca en las dos reglas", () => {
    const viewport = container.querySelector<HTMLElement>(".canvas-viewport")!;
    act(() => {
      viewport.dispatchEvent(new MouseEvent("pointermove", { clientX: 350, clientY: 230 }));
    });
    expect(ruler("horizontal")?.querySelector(".ruler-pointer")?.getAttribute("x1")).toBe("300.5");
    expect(ruler("vertical")?.querySelector(".ruler-pointer")?.getAttribute("y1")).toBe("200.5");

    act(() => {
      viewport.dispatchEvent(new MouseEvent("pointerleave"));
    });
    expect(container.querySelector(".ruler-pointer")).toBeNull();
  });

  it("⇧R las oculta y las vuelve a enseñar", () => {
    const press = () =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "R", shiftKey: true, cancelable: true }));
      });

    press();
    expect(ruler("horizontal")).toBeNull();
    expect(ruler("vertical")).toBeNull();
    press();
    expect(ruler("horizontal")).not.toBeNull();
  });

  it("⇧R no hace nada mientras se escribe en un campo", () => {
    const input = document.createElement("input");
    container.append(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "R", shiftKey: true, bubbles: true }));
    });
    expect(ruler("horizontal")).not.toBeNull();
  });

  it("el botón Reglas también las oculta, y dice si están puestas", () => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Reglas")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    act(() => button.click());
    expect(ruler("horizontal")).toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });
});
